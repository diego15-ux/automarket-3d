// AutoMarket.exe: un clic y se enciende todo lo que hace falta para usar AutoMarket en tu PC.
//
//  1. MySQL y Apache de XAMPP (si no están encendidos).
//  2. La base al día: aplica las migraciones nuevas y, si hubo alguna, regenera el cliente de Prisma.
//  3. La API, la web y el almacén de imágenes, y abre la página en el navegador.
//
// Cerrar la ventana (o Ctrl + C) apaga la API, la web y las imágenes. MySQL y Apache siguen
// encendidos (se apagan desde XAMPP), así nunca se corta la base a medias.
//
//	AutoMarket.exe                 → todo lo de arriba
//	AutoMarket.exe datos-prueba    → además crea las cuentas y autos de prueba antes de abrir
//
// Solo ejecuta programas del proyecto y de XAMPP. No borra archivos ni cambia nada fuera del proyecto.
//
// Compilar (desde scripts/launcher): python3 make_icon.py && GOOS=windows GOARCH=amd64 go build -ldflags="-s -w" -o ../../AutoMarket.exe
package main

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"time"
)

var in = bufio.NewReader(os.Stdin)

func main() {
	setupConsole("AutoMarket 3D")
	// Ctrl + C lo atiende cada programa (API, web…); esta ventana espera a que se apaguen.
	signal.Ignore(os.Interrupt)

	fmt.Println()
	fmt.Println("  AutoMarket 3D")
	fmt.Println("  ─────────────")

	root, err := projectRoot()
	if err != nil {
		fail("No encuentro la carpeta del proyecto. Deja AutoMarket.exe dentro de la carpeta automarket-3d (junto a package.json).")
		return
	}
	if err := os.Chdir(root); err != nil {
		fail("No pude entrar a la carpeta del proyecto: " + err.Error())
		return
	}
	if _, err := exec.LookPath("node"); err != nil {
		fail("No encuentro Node.js. Instálalo desde nodejs.org y vuelve a abrir AutoMarket.")
		return
	}

	// Ya abierto en otra ventana: solo abre la página.
	if portOpen(4000) && portOpen(3000) {
		step("AutoMarket ya está encendido en otra ventana. Abro la página.")
		openURL("http://localhost:3000")
		time.Sleep(2 * time.Second)
		return
	}

	xampp := findXampp()
	if !startMySQL(xampp) {
		return
	}
	startApache(xampp)

	step("Revisando que la base de datos esté al día…")
	output, err := capture("npm run db:deploy -w @automarket/api")
	switch {
	case err != nil:
		fmt.Println(indent(output))
		warn("No pude revisar la base de datos (mira el mensaje de arriba). Sigo igual.")
	case strings.Contains(output, "Applying migration"):
		ok("Base de datos actualizada con los cambios nuevos.")
		step("Preparando la conexión con la base…")
		if out, err := capture("npm run db:generate -w @automarket/api"); err != nil {
			fmt.Println(indent(out))
			warn("No pude preparar la conexión con la base (mira el mensaje de arriba).")
		}
	default:
		ok("Base de datos al día.")
	}

	if len(os.Args) > 1 && os.Args[1] == "datos-prueba" {
		step("Creando las cuentas y autos de prueba…")
		run("npm run db:seed -w @automarket/api")
		run("npm run db:seed:prueba -w @automarket/api")
	}

	step("Encendiendo la API, la web y las imágenes. La página se abre sola en tu navegador.")
	fmt.Println("  Para apagar todo, cierra esta ventana o presiona Ctrl + C.")
	fmt.Println()
	cmd := exec.Command("node", "scripts/dev-all.mjs")
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	_ = cmd.Run()
	fmt.Println("\n  AutoMarket se apagó. MySQL y Apache siguen encendidos en XAMPP.")
	time.Sleep(2 * time.Second)
}

// startMySQL enciende el MySQL de XAMPP si no responde en el puerto 3306.
func startMySQL(xampp string) bool {
	if portOpen(3306) {
		ok("MySQL encendido.")
		return true
	}
	mysqld := filepath.Join(xampp, "mysql", "bin", "mysqld.exe")
	if xampp != "" && exists(mysqld) {
		step("Encendiendo MySQL de XAMPP…")
		if err := startDetached(xampp, mysqld, "--defaults-file="+filepath.Join(xampp, "mysql", "bin", "my.ini"), "--standalone"); err == nil && waitPort(3306, 40*time.Second) {
			ok("MySQL encendido.")
			return true
		}
		warn("MySQL no arrancó. Ábrelo desde el panel de XAMPP (botón «Start» de MySQL) para ver el motivo.")
	} else {
		warn("No encuentro XAMPP en C:\\xampp. Enciende MySQL desde el panel de XAMPP.")
	}
	for {
		fmt.Print("  Cuando MySQL esté encendido presiona Enter (o escribe 0 para salir): ")
		if readLine() == "0" {
			return false
		}
		if portOpen(3306) {
			ok("MySQL encendido.")
			return true
		}
	}
}

// startApache enciende el Apache de XAMPP (phpMyAdmin). AutoMarket no lo necesita: si falla, solo avisa.
func startApache(xampp string) {
	if portOpen(80) {
		ok("Apache encendido.")
		return
	}
	httpd := filepath.Join(xampp, "apache", "bin", "httpd.exe")
	if xampp == "" || !exists(httpd) {
		return
	}
	step("Encendiendo Apache de XAMPP…")
	if err := startDetached(xampp, httpd); err == nil && waitPort(80, 15*time.Second) {
		ok("Apache encendido (phpMyAdmin en http://localhost/phpmyadmin).")
		return
	}
	warn("Apache no arrancó (puede que otro programa use el puerto 80). AutoMarket funciona igual.")
}

// findXampp busca la carpeta de XAMPP en los lugares de siempre.
func findXampp() string {
	candidates := []string{os.Getenv("AUTOMARKET_XAMPP"), `C:\xampp`, `D:\xampp`, `E:\xampp`}
	for _, dir := range candidates {
		if dir != "" && exists(filepath.Join(dir, "xampp-control.exe")) {
			return dir
		}
	}
	return ""
}

// projectRoot busca package.json junto al .exe (o en la carpeta actual, si se abre desde una terminal).
func projectRoot() (string, error) {
	candidates := []string{}
	if exe, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Dir(exe))
	}
	if wd, err := os.Getwd(); err == nil {
		candidates = append(candidates, wd)
	}
	for _, dir := range candidates {
		data, err := os.ReadFile(filepath.Join(dir, "package.json"))
		if err == nil && strings.Contains(string(data), `"name": "automarket-3d"`) {
			return dir, nil
		}
	}
	return "", os.ErrNotExist
}

func portOpen(port int) bool {
	conn, err := net.DialTimeout("tcp", fmt.Sprintf("127.0.0.1:%d", port), 800*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func waitPort(port int, limit time.Duration) bool {
	deadline := time.Now().Add(limit)
	for time.Now().Before(deadline) {
		if portOpen(port) {
			return true
		}
		time.Sleep(700 * time.Millisecond)
	}
	return false
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// capture corre un comando del proyecto y devuelve lo que imprimió (para decidir el siguiente paso).
func capture(command string) (string, error) {
	out, err := shell(command).CombinedOutput()
	return string(out), err
}

// run corre un comando del proyecto mostrando su salida en esta ventana.
func run(command string) {
	cmd := shell(command)
	cmd.Stdin, cmd.Stdout, cmd.Stderr = os.Stdin, os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		warn(fmt.Sprintf("Terminó con un error (%v). Revisa los mensajes de arriba.", err))
	}
}

func indent(text string) string {
	lines := strings.Split(strings.TrimSpace(text), "\n")
	for i, line := range lines {
		lines[i] = "    " + line
	}
	return strings.Join(lines, "\n")
}

func step(message string) { fmt.Println("\n  › " + message) }
func ok(message string)   { fmt.Println("  \x1b[32m✓\x1b[0m " + message) }
func warn(message string) { fmt.Println("  \x1b[33m!\x1b[0m " + message) }

// readLine lee lo que escribes; si la entrada se cerró, responde «0» (salir) para no quedarse en bucle.
func readLine() string {
	line, err := in.ReadString('\n')
	if err != nil && strings.TrimSpace(line) == "" {
		return "0"
	}
	return strings.TrimSpace(line)
}

func fail(message string) {
	fmt.Println("\n  " + message)
	fmt.Print("\n  Presiona Enter para cerrar.")
	readLine()
}
