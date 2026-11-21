module pc05/host

go 1.22

require (
	github.com/jchv/go-webview2 v0.0.0
	golang.org/x/sys v0.30.0
)

replace github.com/jchv/go-webview2 => ./third_party/go-webview2

replace golang.org/x/sys => ./third_party/x-sys
