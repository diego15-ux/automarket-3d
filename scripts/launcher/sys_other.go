//go:build !windows

package main

import "os/exec"

// Solo para compilar y probar en otros sistemas: AutoMarket.exe está pensado para Windows.
func setupConsole(string) {}

func startDetached(dir, program string, args ...string) error {
	cmd := exec.Command(program, args...)
	cmd.Dir = dir
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

func openURL(url string) { _ = exec.Command("xdg-open", url).Start() }

func shell(command string) *exec.Cmd { return exec.Command("sh", "-c", command) }
