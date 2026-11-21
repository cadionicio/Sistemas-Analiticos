//go:build windows

package main

import (
	_ "embed"
	"encoding/json"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unsafe"

	"github.com/wailsapp/go-webview2/pkg/edge"
	"golang.org/x/sys/windows"
)

//go:embed web/index.html
var paginaHTML []byte

//go:embed recursos/app.ico
var iconoICO []byte

const nombreCarpetaDatos = "07_Sistema_Analisis_Predictivo_Inventarios_datos"

type carpeta struct {
	raiz, perfilWeb, bd, config string
	soloLectura, temporal       bool
}

var datosApp carpeta

// Registro de diagnóstico (texto breve en la carpeta de datos; el modo sin rastro lo borra al cerrar).
var paginaServida, interfazLista bool

func registrar(txt string) {
	if datosApp.raiz == "" {
		return
	}
	f, err := os.OpenFile(filepath.Join(datosApp.raiz, "registro.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return
	}
	defer f.Close()
	_, _ = f.WriteString(time.Now().Format("2006-01-02 15:04:05") + "  " + txt + "\r\n")
}

type configHost struct {
	SinRastro bool `json:"sinRastro"`
}

func leerConfig() configHost {
	var c configHost
	if b, err := os.ReadFile(datosApp.config); err == nil {
		_ = json.Unmarshal(b, &c)
	}
	return c
}

// prepararCarpetaDatos crea la ÚNICA carpeta que usa el sistema (oculta, junto al EXE).
// Si el EXE corre dentro de un ZIP sin extraer o en una ubicación de solo lectura, trabaja en modo "solo lectura":
// la BD vive en memoria y el perfil del motor web va a una carpeta temporal que se borra al cerrar.
func prepararCarpetaDatos() carpeta {
	exe, _ := os.Executable()
	dir := filepath.Dir(exe)
	low := strings.ToLower(dir)
	enZip := strings.Contains(low, `\temp\`) && (strings.Contains(low, ".zip") || strings.Contains(low, `\temp1_`) || strings.Contains(low, `\rar$`) || strings.Contains(low, `\7z`))
	c := carpeta{raiz: filepath.Join(dir, nombreCarpetaDatos)}
	escribible := false
	if !enZip && os.MkdirAll(c.raiz, 0o755) == nil {
		prueba := filepath.Join(c.raiz, ".prueba_escritura")
		if os.WriteFile(prueba, []byte("ok"), 0o644) == nil {
			_ = os.Remove(prueba)
			escribible = true
		}
	}
	if escribible {
		_ = windows.SetFileAttributes(u16(c.raiz), windows.FILE_ATTRIBUTE_HIDDEN)
	} else {
		tmp, err := os.MkdirTemp("", "SADPGI-")
		if err != nil {
			tmp = filepath.Join(os.TempDir(), "SADPGI-tmp")
			_ = os.MkdirAll(tmp, 0o755)
		}
		c = carpeta{raiz: tmp, soloLectura: true, temporal: true}
	}
	c.perfilWeb = filepath.Join(c.raiz, "perfil_web")
	c.bd = filepath.Join(c.raiz, "sadpgi.sqlite")
	c.config = filepath.Join(c.raiz, "config.json")
	datosApp = c
	return c
}

// limpiarAlSalir: en modo temporal borra todo; en "modo sin rastro" borra el perfil web (caché, cookies, registros),
// conservando la BD. Los procesos del motor web tardan unos instantes en cerrarse: se reintenta hasta 6 s.
func limpiarAlSalir(c carpeta) {
	objetivo := ""
	if c.temporal {
		objetivo = c.raiz
	} else if leerConfig().SinRastro {
		objetivo = c.perfilWeb
		_ = os.Remove(filepath.Join(c.raiz, "registro.log"))
	}
	if objetivo == "" {
		return
	}
	for i := 0; i < 30; i++ {
		if os.RemoveAll(objetivo) == nil {
			if _, err := os.Stat(objetivo); os.IsNotExist(err) {
				return
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
}

// ---------------------------------------------------------------------------------------------------------------
// Servidor en memoria: http://sadpgi.localhost/ (nada sale a la red; no hay puertos abiertos).

func responder(args *edge.ICoreWebView2WebResourceRequestedEventArgs, estado int, razon, tipo string, cuerpo []byte) {
	env := wv.Environment()
	if env == nil {
		return
	}
	cab := "Content-Type: " + tipo + "\nCache-Control: no-store"
	// OJO: CreateWebResourceResponse de go-webview2 v1.0.23 descarta el contenido (la variable del stream queda
	// sombreada y se envía nulo → página en blanco). Se crea la respuesta vacía y el cuerpo se asigna con PutByteContent.
	resp, err := env.CreateWebResourceResponse(nil, estado, razon, cab)
	if err != nil {
		registrar("error creando respuesta: " + err.Error())
		return
	}
	if len(cuerpo) > 0 {
		if err := resp.PutByteContent(cuerpo); err != nil {
			registrar("error asignando contenido: " + err.Error())
		}
	}
	_ = args.PutResponse(resp)
	_ = resp.Release()
}
func responderJSON(args *edge.ICoreWebView2WebResourceRequestedEventArgs, v any) {
	b, _ := json.Marshal(v)
	responder(args, 200, "OK", "application/json; charset=utf-8", b)
}

func leerCuerpo(req *edge.ICoreWebView2WebResourceRequest) []byte {
	s, err := req.GetContent()
	if err != nil || s == nil {
		return nil
	}
	defer s.Release()
	b, _ := io.ReadAll(s)
	return b
}

// escribirAtomico evita dejar una BD corrupta si el equipo se apaga a mitad de la escritura.
func escribirAtomico(ruta string, datos []byte) error {
	tmp := ruta + ".tmp"
	if err := os.WriteFile(tmp, datos, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, ruta)
}

type operacion struct {
	args     *edge.ICoreWebView2WebResourceRequestedEventArgs
	deferral *edge.ICoreWebView2Deferral
	nombre   string
	datos    []byte
}

var pendiente *operacion

func atenderRecurso(req *edge.ICoreWebView2WebResourceRequest, args *edge.ICoreWebView2WebResourceRequestedEventArgs) {
	uri, _ := req.GetUri()
	metodo, _ := req.GetMethod()
	u, err := url.Parse(uri)
	if err != nil || !strings.EqualFold(u.Host, "sadpgi.localhost") {
		return
	}
	switch {
	case u.Path == "/" || u.Path == "/index.html":
		paginaServida = true
		registrar("página servida (" + metodo + " " + u.Path + ")")
		responder(args, 200, "OK", "text/html; charset=utf-8", paginaHTML)
	case u.Path == "/favicon.ico":
		responder(args, 200, "OK", "image/x-icon", iconoICO)
	case u.Path == "/__host/info":
		interfazLista = true
		registrar("interfaz iniciada")
		exe, _ := os.Executable()
		responderJSON(args, map[string]any{"modo": "EXE", "version": "1.0.0", "soloLectura": datosApp.soloLectura, "carpetaDatos": datosApp.raiz, "exe": exe, "sinRastro": leerConfig().SinRastro})
	case u.Path == "/__host/bd" && metodo == "GET":
		if datosApp.soloLectura {
			responder(args, 204, "No Content", "application/octet-stream", nil)
			return
		}
		if b, err := os.ReadFile(datosApp.bd); err == nil && len(b) > 0 {
			responder(args, 200, "OK", "application/octet-stream", b)
		} else {
			responder(args, 204, "No Content", "application/octet-stream", nil)
		}
	case u.Path == "/__host/bd" && metodo == "POST":
		if datosApp.soloLectura {
			responderJSON(args, map[string]any{"ok": false, "error": "solo_lectura"})
			return
		}
		b := leerCuerpo(req)
		if len(b) < 100 || string(b[:15]) != "SQLite format 3" {
			responderJSON(args, map[string]any{"ok": false, "error": "contenido_invalido"})
			return
		}
		if err := escribirAtomico(datosApp.bd, b); err != nil {
			responderJSON(args, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		responderJSON(args, map[string]any{"ok": true, "bytes": len(b)})
	case u.Path == "/__host/config" && metodo == "POST":
		var c configHost
		_ = json.Unmarshal(leerCuerpo(req), &c)
		if !datosApp.soloLectura {
			b, _ := json.Marshal(c)
			_ = escribirAtomico(datosApp.config, b)
		}
		responderJSON(args, map[string]any{"ok": true})
	case u.Path == "/__host/guardar" && metodo == "POST":
		// El diálogo nativo NO se abre dentro del evento del motor web (evita reentrada): se difiere al bucle de la ventana.
		if pendiente != nil {
			responderJSON(args, map[string]any{"ok": false, "error": "ocupado"})
			return
		}
		d, err := args.GetDeferral()
		if err != nil {
			responderJSON(args, map[string]any{"ok": false, "error": err.Error()})
			return
		}
		args.AddRef()
		pendiente = &operacion{args: args, deferral: d, nombre: u.Query().Get("nombre"), datos: leerCuerpo(req)}
		pPostMessage.Call(hwndPrincipal, wmApp, 0, 0)
	case u.Path == "/__host/cerrar" && metodo == "POST":
		responderJSON(args, map[string]any{"ok": true})
		pPostMessage.Call(hwndPrincipal, wmAppCerrar, 0, 0)
	default:
		responder(args, 404, "Not Found", "text/plain; charset=utf-8", []byte("No encontrado"))
	}
}

// atenderPendiente abre "Guardar como" (fuera del evento del motor web) y completa la respuesta diferida.
func atenderPendiente() {
	op := pendiente
	if op == nil {
		return
	}
	pendiente = nil
	ruta, ok := dialogoGuardarComo(op.nombre)
	var res map[string]any
	switch {
	case !ok:
		res = map[string]any{"ok": false, "error": "cancelado"}
	default:
		if err := os.WriteFile(ruta, op.datos, 0o644); err != nil {
			res = map[string]any{"ok": false, "error": "No se pudo escribir el archivo: " + err.Error()}
		} else {
			res = map[string]any{"ok": true, "ruta": ruta}
		}
	}
	responderJSON(op.args, res)
	_ = op.deferral.Complete()
	_ = op.deferral.Release()
	op.args.Release()
}

// ---------------------------------------------------------------------------------------------------------------
// Diálogo nativo "Guardar como" (comdlg32). Los informes y respaldos solo se guardan donde el usuario elige.

var (
	comdlg32         = windows.NewLazySystemDLL("comdlg32.dll")
	pGetSaveFileName = comdlg32.NewProc("GetSaveFileNameW")
)

type openFileName struct {
	StructSize      uint32
	Owner           uintptr
	Instance        uintptr
	Filter          *uint16
	CustomFilter    *uint16
	MaxCustFilter   uint32
	FilterIndex     uint32
	File            *uint16
	MaxFile         uint32
	FileTitle       *uint16
	MaxFileTitle    uint32
	InitialDir      *uint16
	Title           *uint16
	Flags           uint32
	FileOffset      uint16
	FileExtension   uint16
	DefExt          *uint16
	CustData        uintptr
	FnHook          uintptr
	TemplateName    *uint16
	PvReserved      uintptr
	DwReserved      uint32
	FlagsEx         uint32
}

var filtros = map[string]string{
	"docx": "Documento de Word (*.docx)", "pdf": "Documento PDF (*.pdf)", "pptx": "Presentación de PowerPoint (*.pptx)",
	"xlsx": "Libro de Excel (*.xlsx)", "sqlite": "Base de datos del sistema (*.sqlite)", "png": "Imagen PNG (*.png)", "csv": "Texto CSV (*.csv)",
}

func dialogoGuardarComo(sugerido string) (string, bool) {
	nombre := filepath.Base(strings.ReplaceAll(sugerido, "..", ""))
	if nombre == "" || nombre == "." {
		nombre = "archivo"
	}
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(nombre)), ".")
	desc := filtros[ext]
	if desc == "" {
		desc = "Archivo (*." + ext + ")"
	}
	filtro, _ := windows.UTF16FromString(desc + "\x00*." + ext + "\x00Todos los archivos (*.*)\x00*.*\x00")
	filtro = append(filtro, 0)
	buf := make([]uint16, 1024)
	copy(buf, windows.StringToUTF16(nombre))
	docs, _ := windows.KnownFolderPath(windows.FOLDERID_Documents, 0)
	of := openFileName{Owner: hwndPrincipal, Filter: &filtro[0], FilterIndex: 1, File: &buf[0], MaxFile: uint32(len(buf)),
		Title: u16("Guardar como · " + tituloVentana), DefExt: u16(ext), InitialDir: u16(docs),
		Flags: 0x2 | 0x800 | 0x8 | 0x80000 | 0x200000} // OVERWRITEPROMPT | PATHMUSTEXIST | NOCHANGEDIR | EXPLORER | DONTADDTORECENT
	of.StructSize = uint32(unsafe.Sizeof(of))
	r, _, _ := pGetSaveFileName.Call(uintptr(unsafe.Pointer(&of)))
	if r == 0 {
		return "", false
	}
	return windows.UTF16ToString(buf), true
}
