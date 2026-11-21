// Aplicación de escritorio — host Windows delgado del sistema de costeo de la cadena de suministro.
// Responsabilidades (capa P5 / adaptador de almacenamiento del EXE):
//   - Abrir una ventana WebView2 con el MISMO HTML de la versión offline (incrustado).
//   - Guardar la base SQLite en %LOCALAPPDATA%\CosteoCadenaSuministro\data\costeo.sqlite con escritura atómica y respaldos.
//   - Guardar exportaciones en Documentos\Costeo_Exportaciones.
// No contiene fórmulas de costeo: todo el cálculo vive en el núcleo web compartido.
package main

import (
	"crypto/sha256"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/jchv/go-webview2"
	"github.com/jchv/go-webview2/webviewloader"
	"golang.org/x/sys/windows"
)

//go:embed assets/index.html
var indexHTML []byte

var version = "dev" // se fija en la compilación con -ldflags "-X main.version=..."

const titulo = "Costeo de la Cadena de Suministro — Sistema Informático Dinámico Inteligente Estocástico Predictivo de Costeo de la Cadena de Suministro Integral"

type paths struct{ base, app, bin, data, backups, logs, webview, exports string }

func resolvePaths() paths {
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		d, _ := os.UserCacheDir()
		base = d
	}
	base = filepath.Join(base, "CosteoCadenaSuministro")
	home, _ := os.UserHomeDir()
	docs := filepath.Join(home, "Documents")
	return paths{base, filepath.Join(base, "app"), filepath.Join(base, "bin"), filepath.Join(base, "data"),
		filepath.Join(base, "data", "respaldos"), filepath.Join(base, "logs"), filepath.Join(base, "webview"),
		filepath.Join(docs, "Costeo_Exportaciones")}
}

func msgBox(text, caption string, flags uint32) {
	t, _ := windows.UTF16PtrFromString(text)
	c, _ := windows.UTF16PtrFromString(caption)
	windows.MessageBox(0, t, c, flags)
}

// writeAtomic escribe en un temporal, sincroniza y reemplaza: nunca deja un archivo a medias.
func writeAtomic(dst string, data []byte) error {
	tmp := dst + ".tmp"
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if _, err = f.Write(data); err == nil {
		err = f.Sync()
	}
	if cerr := f.Close(); err == nil {
		err = cerr
	}
	if err != nil {
		os.Remove(tmp)
		return err
	}
	return os.Rename(tmp, dst)
}

func sameContent(path string, data []byte) bool {
	b, err := os.ReadFile(path)
	if err != nil {
		return false
	}
	a := sha256.Sum256(b)
	c := sha256.Sum256(data)
	return a == c
}

var safeName = regexp.MustCompile(`[^A-Za-z0-9._\- ]`)

func main() {
	p := resolvePaths()
	for _, d := range []string{p.app, p.bin, p.data, p.backups, p.logs, p.webview} {
		if err := os.MkdirAll(d, 0o700); err != nil {
			msgBox("No se pudo crear la carpeta de datos:\n"+d+"\n\n"+err.Error(), "Costeo de la Cadena de Suministro — error al iniciar", windows.MB_ICONERROR)
			return
		}
	}
	lf, _ := os.OpenFile(filepath.Join(p.logs, "app.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600)
	if lf != nil {
		defer lf.Close()
		log.SetOutput(lf)
	}
	log.Printf("inicio version=%s base=%s", version, p.base)
	// Nitidez en pantallas de alta densidad: DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 (-4).
	if proc := windows.NewLazySystemDLL("user32.dll").NewProc("SetProcessDpiAwarenessContext"); proc.Find() == nil {
		proc.Call(^uintptr(3))
	}

	// 1) DLL oficial de Microsoft para localizar el runtime WebView2 (carga estándar, sin mapeo en memoria).
	dll := filepath.Join(p.bin, "WebView2Loader.dll")
	if !sameContent(dll, webviewloader.WebView2Loader) {
		if err := writeAtomic(dll, webviewloader.WebView2Loader); err != nil {
			log.Printf("error escribiendo DLL: %v", err)
		}
	}
	if err := windows.SetDllDirectory(p.bin); err != nil {
		log.Printf("SetDllDirectory: %v", err)
	}
	if v, err := webviewloader.GetInstalledVersion(); err != nil || v == "" {
		log.Printf("WebView2 no disponible: v=%q err=%v", v, err)
		msgBox("Esta aplicación necesita Microsoft Edge WebView2 Runtime, que viene incluido en Windows 11 y en Windows 10 actualizado.\n\n"+
			"No se encontró en este equipo. Puede usar la versión offline (archivo .html) en Edge o Chrome mientras tanto.\n\n"+
			"Detalle técnico registrado en:\n"+filepath.Join(p.logs, "app.log"), "Costeo de la Cadena de Suministro — falta WebView2 Runtime", windows.MB_ICONWARNING)
		return
	} else {
		log.Printf("WebView2 runtime %s", v)
	}

	// 2) Página de la aplicación (mismo archivo que el HTML offline).
	page := filepath.Join(p.app, "index.html")
	if !sameContent(page, indexHTML) {
		if err := writeAtomic(page, indexHTML); err != nil {
			msgBox("No se pudo preparar la interfaz:\n"+err.Error(), "Costeo de la Cadena de Suministro — error al iniciar", windows.MB_ICONERROR)
			return
		}
	}

	w := webview2.NewWithOptions(webview2.WebViewOptions{
		Debug:     false,
		AutoFocus: true,
		DataPath:  p.webview,
		WindowOptions: webview2.WindowOptions{
			Title:  titulo,
			Width:  1440,
			Height: 900,
			Center: true,
		},
	})
	if w == nil {
		log.Printf("no se pudo crear la ventana WebView2")
		msgBox("No se pudo crear la ventana de la aplicación (WebView2).\nDetalle en: "+filepath.Join(p.logs, "app.log"), "Costeo de la Cadena de Suministro — error al iniciar", windows.MB_ICONERROR)
		return
	}
	defer w.Destroy()

	dbPath := filepath.Join(p.data, "costeo.sqlite")
	migrarBaseAnterior(dbPath)
	w.Bind("hostInfo", func() map[string]any {
		return map[string]any{"host": "EXE", "version": version, "dbPath": dbPath, "exportDir": p.exports, "logDir": p.logs}
	})
	w.Bind("hostDbLoad", func() (string, error) {
		b, err := os.ReadFile(dbPath)
		if os.IsNotExist(err) {
			return "", nil
		}
		if err != nil {
			log.Printf("leer base: %v", err)
			return "", err
		}
		return base64.StdEncoding.EncodeToString(b), nil
	})
	// Transferencia por bloques: el puente WebView2 entrega los resultados como texto de script, y un solo
	// mensaje de decenas de MB deja la interfaz detenida al abrir. La base se lee y se escribe en bloques.
	var loadBuf []byte
	w.Bind("hostDbInfo", func() map[string]any {
		b, err := os.ReadFile(dbPath)
		if err != nil {
			loadBuf = nil
			return map[string]any{"exists": false, "size": 0}
		}
		loadBuf = b
		log.Printf("abrir base: %d bytes", len(b))
		return map[string]any{"exists": true, "size": len(b)}
	})
	w.Bind("hostDbLoadChunk", func(offset, length int) (string, error) {
		if loadBuf == nil || offset < 0 || offset > len(loadBuf) || length <= 0 {
			return "", nil
		}
		end := offset + length
		if end > len(loadBuf) {
			end = len(loadBuf)
		}
		chunk := base64.StdEncoding.EncodeToString(loadBuf[offset:end])
		if end == len(loadBuf) {
			loadBuf = nil // liberar memoria al terminar
		}
		return chunk, nil
	})
	saveBufs := map[string][]byte{}
	w.Bind("hostDbSaveBegin", func(size int) string {
		id := time.Now().Format("150405.000000000")
		saveBufs[id] = make([]byte, 0, size)
		return id
	})
	w.Bind("hostDbSaveChunk", func(id, b64 string) bool {
		buf, ok := saveBufs[id]
		if !ok {
			return false
		}
		d, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			delete(saveBufs, id)
			return false
		}
		saveBufs[id] = append(buf, d...)
		return true
	})
	var lastBackup time.Time
	guardar := func(data []byte) map[string]any {
		at := time.Now().Format(time.RFC3339)
		if len(data) < 100 || string(data[:15]) != "SQLite format 3" {
			log.Printf("guardar: contenido inválido (%d bytes)", len(data))
			return map[string]any{"ok": false, "error": "contenido no es una base SQLite válida", "at": at}
		}
		// respaldo rotativo (máximo uno cada 5 minutos, se conservan 10)
		if _, err := os.Stat(dbPath); err == nil && time.Since(lastBackup) > 5*time.Minute {
			if old, err := os.ReadFile(dbPath); err == nil {
				name := filepath.Join(p.backups, "costeo_"+time.Now().Format("20060102_150405")+".sqlite")
				if writeAtomic(name, old) == nil {
					lastBackup = time.Now()
					files, _ := filepath.Glob(filepath.Join(p.backups, "costeo_*.sqlite"))
					sort.Strings(files)
					for len(files) > 10 {
						os.Remove(files[0])
						files = files[1:]
					}
				}
			}
		}
		if err := writeAtomic(dbPath, data); err != nil {
			log.Printf("guardar base: %v", err)
			return map[string]any{"ok": false, "error": err.Error(), "at": at}
		}
		sum := sha256.Sum256(data)
		return map[string]any{"ok": true, "bytes": len(data), "path": dbPath, "at": at, "sha256": hex.EncodeToString(sum[:])}
	}
	w.Bind("hostDbSaveCommit", func(id string) map[string]any {
		buf, ok := saveBufs[id]
		delete(saveBufs, id)
		if !ok {
			return map[string]any{"ok": false, "error": "guardado por bloques no iniciado", "at": time.Now().Format(time.RFC3339)}
		}
		return guardar(buf)
	})
	w.Bind("hostDbSave", func(b64 string) map[string]any {
		data, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			return map[string]any{"ok": false, "error": "contenido no es una base SQLite válida", "at": time.Now().Format(time.RFC3339)}
		}
		return guardar(data)
	})
	exportar := func(name string, data []byte) map[string]any {
		name = safeName.ReplaceAllString(filepath.Base(name), "_")
		if name == "" || strings.HasPrefix(name, ".") {
			return map[string]any{"ok": false, "error": "nombre de archivo inválido"}
		}
		if err := os.MkdirAll(p.exports, 0o700); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		dst := filepath.Join(p.exports, name)
		if err := writeAtomic(dst, data); err != nil {
			return map[string]any{"ok": false, "error": err.Error()}
		}
		log.Printf("exportado %s (%d bytes)", dst, len(data))
		return map[string]any{"ok": true, "path": dst}
	}
	w.Bind("hostExport", func(name, b64 string) map[string]any {
		data, err := base64.StdEncoding.DecodeString(b64)
		if err != nil {
			return map[string]any{"ok": false, "error": "contenido inválido"}
		}
		return exportar(name, data)
	})
	w.Bind("hostExportCommit", func(id, name string) map[string]any {
		buf, ok := saveBufs[id]
		delete(saveBufs, id)
		if !ok {
			return map[string]any{"ok": false, "error": "exportación por bloques no iniciada"}
		}
		return exportar(name, buf)
	})
	w.Bind("hostOpenFolder", func(which string) bool {
		dir := p.exports
		if which == "data" {
			dir = p.data
		} else if which == "logs" {
			dir = p.logs
		}
		os.MkdirAll(dir, 0o700)
		return exec.Command("explorer.exe", dir).Start() == nil
	})
	w.Bind("hostLog", func(msg string) bool {
		if len(msg) > 2000 {
			msg = msg[:2000]
		}
		log.Printf("ui: %s", msg)
		return true
	})

	u := url.URL{Scheme: "file", Path: "/" + filepath.ToSlash(page)}
	log.Printf("navegando a %s", u.String())
	w.Navigate(u.String())
	w.Run()
	log.Printf("cierre normal")
}

// migrarBaseAnterior copia (sin borrar) la base de versiones previas, guardada en
// %LOCALAPPDATA%\PC05\data\pc05.sqlite, cuando la ubicación nueva aún no tiene base.
func migrarBaseAnterior(dbPath string) {
	if _, err := os.Stat(dbPath); err == nil {
		return
	}
	base := os.Getenv("LOCALAPPDATA")
	if base == "" {
		d, _ := os.UserCacheDir()
		base = d
	}
	old := filepath.Join(base, "PC05", "data", "pc05.sqlite")
	data, err := os.ReadFile(old)
	if err != nil || len(data) < 100 || string(data[:15]) != "SQLite format 3" {
		return
	}
	if err := writeAtomic(dbPath, data); err != nil {
		log.Printf("migración de base anterior: %v", err)
		return
	}
	log.Printf("base anterior copiada desde %s", old)
}
