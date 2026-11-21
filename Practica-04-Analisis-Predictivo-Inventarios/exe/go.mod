module sadpgi

go 1.24.7

replace golang.org/x/sys => ./third_party/sys

require (
	github.com/wailsapp/go-webview2 v1.0.23
	golang.org/x/sys v0.27.0
)
