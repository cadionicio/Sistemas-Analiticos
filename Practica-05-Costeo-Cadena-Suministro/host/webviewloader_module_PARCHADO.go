package webviewloader

// PC05 — versión modificada de github.com/jchv/go-webview2/webviewloader (licencia MIT).
// Cambio: se eliminó la carga de WebView2Loader.dll desde memoria (go-winloader).
// El host PC05 escribe la DLL oficial firmada por Microsoft (sdk/x64) en su carpeta de
// datos y la añade con SetDllDirectory; aquí solo se usa la carga estándar de Windows.

import (
	"fmt"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	nativeModule                                       = windows.NewLazyDLL("WebView2Loader")
	nativeCreate                                       = nativeModule.NewProc("CreateCoreWebView2EnvironmentWithOptions")
	nativeCompareBrowserVersions                       = nativeModule.NewProc("CompareBrowserVersions")
	nativeGetAvailableCoreWebView2BrowserVersionString = nativeModule.NewProc("GetAvailableCoreWebView2BrowserVersionString")
)

func load() error {
	if err := nativeModule.Load(); err != nil {
		return fmt.Errorf("no se pudo cargar WebView2Loader.dll: %w", err)
	}
	return nil
}

// CompareBrowserVersions compara dos versiones: -1, 0 o 1.
func CompareBrowserVersions(v1 string, v2 string) (int, error) {
	_v1, err := windows.UTF16PtrFromString(v1)
	if err != nil {
		return 0, err
	}
	_v2, err := windows.UTF16PtrFromString(v2)
	if err != nil {
		return 0, err
	}
	if err := load(); err != nil {
		return 0, err
	}
	var result int32
	_, _, err = nativeCompareBrowserVersions.Call(uintptr(unsafe.Pointer(_v1)), uintptr(unsafe.Pointer(_v2)), uintptr(unsafe.Pointer(&result)))
	if err != windows.ERROR_SUCCESS {
		return 0, err
	}
	return int(result), nil
}

// GetInstalledVersion devuelve la versión instalada del runtime WebView2 o "" si no existe.
func GetInstalledVersion() (string, error) {
	if err := load(); err != nil {
		return "", err
	}
	var result *uint16
	hr, _, _ := nativeGetAvailableCoreWebView2BrowserVersionString.Call(uintptr(unsafe.Pointer(nil)), uintptr(unsafe.Pointer(&result)))
	defer windows.CoTaskMemFree(unsafe.Pointer(result))
	if hr != uintptr(windows.S_OK) {
		if hr&0xFFFF == uintptr(windows.ERROR_FILE_NOT_FOUND) {
			return "", nil
		}
		return "", fmt.Errorf("GetAvailableCoreWebView2BrowserVersionString devolvió HRESULT 0x%X", hr)
	}
	return windows.UTF16PtrToString(result), nil
}

// CreateCoreWebView2EnvironmentWithOptions llama a la función homónima de WebView2Loader.dll.
func CreateCoreWebView2EnvironmentWithOptions(browserExecutableFolder, userDataFolder *uint16, environmentOptions uintptr, environmentCompletedHandle uintptr) (uintptr, error) {
	if err := load(); err != nil {
		return 0, err
	}
	if err := nativeCreate.Find(); err != nil {
		return 0, err
	}
	res, _, _ := nativeCreate.Call(
		uintptr(unsafe.Pointer(browserExecutableFolder)),
		uintptr(unsafe.Pointer(userDataFolder)),
		environmentOptions,
		environmentCompletedHandle,
	)
	return res, nil
}
