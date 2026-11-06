//go:build windows

package main

import (
	"os/exec"
	"syscall"
	"unsafe"
)

var (
	kernel32        = syscall.NewLazyDLL("kernel32.dll")
	setConsoleTitle = kernel32.NewProc("SetConsoleTitleW")
	getConsoleMode  = kernel32.NewProc("GetConsoleMode")
	setConsoleMode  = kernel32.NewProc("SetConsoleMode")
)

const (
	enableVirtualTerminal = 0x0004     // colores ANSI en la consola clásica
	detachedProcess       = 0x00000008 // sin consola: sobrevive al cerrar esta ventana
	newProcessGroup       = 0x00000200 // no recibe el Ctrl + C de esta ventana
)

// setupConsole pone el título de la ventana y activa los colores.
func setupConsole(title string) {
	if name, err := syscall.UTF16PtrFromString(title); err == nil {
		setConsoleTitle.Call(uintptr(unsafe.Pointer(name)))
	}
	if out, err := syscall.GetStdHandle(syscall.STD_OUTPUT_HANDLE); err == nil {
		var mode uint32
		if ret, _, _ := getConsoleMode.Call(uintptr(out), uintptr(unsafe.Pointer(&mode))); ret != 0 {
			setConsoleMode.Call(uintptr(out), uintptr(mode|enableVirtualTerminal))
		}
	}
}

// startDetached enciende un programa de XAMPP aparte de esta ventana (cerrarla no lo apaga).
func startDetached(dir, program string, args ...string) error {
	cmd := exec.Command(program, args...)
	cmd.Dir = dir
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: detachedProcess | newProcessGroup}
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

func openURL(url string) {
	_ = exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
}

func shell(command string) *exec.Cmd { return exec.Command("cmd", "/c", command) }
