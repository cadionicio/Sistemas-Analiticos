//go:build windows

// Sistema de Análisis de Datos y Predictivo de Gestión de Inventarios — ejecutable de Windows.
//
// Envoltorio nativo (Go + WebView2) del MISMO núcleo que el HTML: una ventana Win32 (subsistema GUI, sin consola)
// que muestra la aplicación servida desde memoria (embed) en el host virtual http://sadpgi.localhost/.
// Residuo cero: todo lo que se escribe queda en la subcarpeta oculta "07_Sistema_Analisis_Predictivo_Inventarios_datos"
// junto al EXE (BD, perfil de WebView2). Sin instalación, sin registro, sin %APPDATA%, sin procesos de consola.
package main

import (
	"os"
	"runtime"
	"syscall"
	"unsafe"

	"github.com/wailsapp/go-webview2/pkg/edge"
	"golang.org/x/sys/windows"
)

const (
	tituloVentana = "Sistema de Análisis de Datos y Predictivo de Gestión de Inventarios"
	claseVentana  = "SADPGI_Ventana"
	origen        = "http://sadpgi.localhost"
	wmApp         = 0x8000 // WM_APP: operaciones diferidas (diálogo "Guardar como")
	wmAppCerrar   = 0x8001
	idTimerCierre = 7
	idTimerVigia  = 8
)

var (
	user32            = windows.NewLazySystemDLL("user32.dll")
	kernel32          = windows.NewLazySystemDLL("kernel32.dll")
	pRegisterClassEx  = user32.NewProc("RegisterClassExW")
	pCreateWindowEx   = user32.NewProc("CreateWindowExW")
	pDefWindowProc    = user32.NewProc("DefWindowProcW")
	pGetMessage       = user32.NewProc("GetMessageW")
	pTranslate        = user32.NewProc("TranslateMessage")
	pDispatch         = user32.NewProc("DispatchMessageW")
	pPostQuit         = user32.NewProc("PostQuitMessage")
	pShowWindow       = user32.NewProc("ShowWindow")
	pUpdateWindow     = user32.NewProc("UpdateWindow")
	pLoadImage        = user32.NewProc("LoadImageW")
	pLoadCursor       = user32.NewProc("LoadCursorW")
	pDestroyWindow    = user32.NewProc("DestroyWindow")
	pPostMessage      = user32.NewProc("PostMessageW")
	pSetTimer         = user32.NewProc("SetTimer")
	pKillTimer        = user32.NewProc("KillTimer")
	pMessageBox       = user32.NewProc("MessageBoxW")
	pGetModuleHandle  = kernel32.NewProc("GetModuleHandleW")
	pSetProcessDpiCtx = user32.NewProc("SetProcessDpiAwarenessContext")
)

type wndClassEx struct {
	Size, Style                        uint32
	WndProc                            uintptr
	ClsExtra, WndExtra                 int32
	Instance, Icon, Cursor, Background windows.Handle
	MenuName, ClassName                *uint16
	IconSm                             windows.Handle
}
type msg struct {
	Hwnd    windows.HWND
	Message uint32
	WParam  uintptr
	LParam  uintptr
	Time    uint32
	Pt      struct{ X, Y int32 }
}
type minMaxInfo struct{ Reserved, MaxSize, MaxPosition, MinTrackSize, MaxTrackSize struct{ X, Y int32 } }

var (
	wv            *edge.Chromium
	hwndPrincipal uintptr
	cerrando      bool
)

func u16(s string) *uint16 { p, _ := windows.UTF16PtrFromString(s); return p }

// aviso muestra un cuadro de mensaje nativo (nunca una consola).
func aviso(texto string, icono uintptr) {
	pMessageBox.Call(hwndPrincipal, uintptr(unsafe.Pointer(u16(texto))), uintptr(unsafe.Pointer(u16(tituloVentana))), icono)
}

func wndProc(h windows.HWND, m uint32, w, l uintptr) uintptr {
	switch m {
	case 0x0005: // WM_SIZE
		if wv != nil {
			wv.Resize()
		}
	case 0x0024: // WM_GETMINMAXINFO: tamaño mínimo cómodo
		mm := (*minMaxInfo)(unsafe.Pointer(l))
		mm.MinTrackSize.X, mm.MinTrackSize.Y = 1024, 640
		return 0
	case 0x0010: // WM_CLOSE: pide a la interfaz que guarde la BD y espera su confirmación (máx. 4 s)
		if wv != nil && !cerrando {
			cerrando = true
			wv.Eval("window.__sadpgiAntesDeCerrar ? window.__sadpgiAntesDeCerrar() : fetch('/__host/cerrar',{method:'POST'})")
			pSetTimer.Call(uintptr(h), idTimerCierre, 4000, 0)
			return 0
		}
	case 0x0113: // WM_TIMER
		if w == idTimerVigia { // vigía de arranque: si la interfaz no inició, avisar con un mensaje claro (nunca pantalla en blanco muda)
			pKillTimer.Call(uintptr(h), idTimerVigia)
			if !interfazLista {
				registrar("vigía: la interfaz no inició (página servida=" + map[bool]string{true: "sí", false: "no"}[paginaServida] + ")")
				aviso("El sistema está tardando en iniciar.\n\nSi la ventana sigue en blanco, cierre y vuelva a abrir el programa. Como alternativa, abra el archivo 08_Sistema_Analisis_Predictivo_Inventarios.html (mismas funciones) con Microsoft Edge o Google Chrome.\n\nDiagnóstico guardado en la carpeta de datos (registro.log).", 0x30)
			}
			return 0
		}
		if w == idTimerCierre { // la interfaz no respondió a tiempo al cerrar → cerrar igual
			pKillTimer.Call(uintptr(h), idTimerCierre)
			pDestroyWindow.Call(uintptr(h))
			return 0
		}
	case wmAppCerrar:
		pKillTimer.Call(uintptr(h), idTimerCierre)
		pDestroyWindow.Call(uintptr(h))
		return 0
	case wmApp:
		atenderPendiente()
		return 0
	case 0x0002: // WM_DESTROY
		pPostQuit.Call(0)
		return 0
	}
	r, _, _ := pDefWindowProc.Call(uintptr(h), uintptr(m), w, l)
	return r
}

func main() {
	runtime.LockOSThread()
	if pSetProcessDpiCtx.Find() == nil {
		pSetProcessDpiCtx.Call(^uintptr(3)) // DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2 (-4)
	}
	datos := prepararCarpetaDatos()

	hInst, _, _ := pGetModuleHandle.Call(0)
	icono, _, _ := pLoadImage.Call(hInst, 1, 1, 0, 0, 0x8040)     // IMAGE_ICON, LR_DEFAULTSIZE|LR_SHARED
	iconoChico, _, _ := pLoadImage.Call(hInst, 1, 1, 16, 16, 0x8000) // LR_SHARED
	cursor, _, _ := pLoadCursor.Call(0, 32512)                       // IDC_ARROW
	wc := wndClassEx{WndProc: syscall.NewCallback(wndProc), ClassName: u16(claseVentana), Instance: windows.Handle(hInst),
		Icon: windows.Handle(icono), IconSm: windows.Handle(iconoChico), Cursor: windows.Handle(cursor), Background: windows.Handle(6)}
	wc.Size = uint32(unsafe.Sizeof(wc))
	pRegisterClassEx.Call(uintptr(unsafe.Pointer(&wc)))
	hwndPrincipal, _, _ = pCreateWindowEx.Call(0, uintptr(unsafe.Pointer(u16(claseVentana))), uintptr(unsafe.Pointer(u16(tituloVentana))),
		0x10CF0000, 0x80000000, 0x80000000, 1366, 800, 0, 0, hInst, 0) // WS_OVERLAPPEDWINDOW|WS_VISIBLE, CW_USEDEFAULT
	pShowWindow.Call(hwndPrincipal, 3) // SW_SHOWMAXIMIZED
	pUpdateWindow.Call(hwndPrincipal)

	wv = edge.NewChromium()
	wv.DataPath = datos.perfilWeb
	wv.SetErrorCallback(func(err error) {
		registrar("error del motor web: " + err.Error())
		aviso("No se pudo iniciar el motor web (Microsoft Edge WebView2).\n\nWindows 10 y 11 lo incluyen normalmente. Si falta, instale «Microsoft Edge WebView2 Runtime» desde el sitio de Microsoft o use el archivo 08_Sistema_Analisis_Predictivo_Inventarios.html con Edge o Chrome.\n\nDetalle: "+err.Error(), 0x10)
		os.Exit(1)
	})
	wv.WebResourceRequestedCallback = atenderRecurso
	if !wv.Embed(hwndPrincipal) {
		aviso("No se pudo crear la ventana del sistema.", 0x10)
		return
	}
	wv.SetBackgroundColour(244, 244, 241, 255)
	if s, err := wv.GetSettings(); err == nil {
		_ = s.PutAreDevToolsEnabled(false)
		_ = s.PutIsStatusBarEnabled(false)
		_ = s.PutAreHostObjectsAllowed(false)
		_ = s.PutIsZoomControlEnabled(true)
	}
	wv.AddWebResourceRequestedFilter(origen+"/*", edge.COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL)
	wv.Resize()
	registrar("inicio · WebView2 listo · carpeta de datos: " + datos.raiz)
	wv.Navigate(origen + "/")
	wv.Focus()
	pSetTimer.Call(hwndPrincipal, idTimerVigia, 20000, 0)

	var m msg
	for {
		r, _, _ := pGetMessage.Call(uintptr(unsafe.Pointer(&m)), 0, 0, 0)
		if int32(r) <= 0 {
			break
		}
		pTranslate.Call(uintptr(unsafe.Pointer(&m)))
		pDispatch.Call(uintptr(unsafe.Pointer(&m)))
	}
	wv.ShuttingDown()
	limpiarAlSalir(datos)
}
