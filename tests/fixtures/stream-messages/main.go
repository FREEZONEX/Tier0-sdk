// Native integration fixture. Build from the backend module to import its real
// issuer; this file never duplicates claims, permission or envelope generation.
package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/FREEZONEX/Tier0-Backend/share/streammessages"
	jwt "github.com/nats-io/jwt/v2"
	"github.com/nats-io/nkeys"
)

const appID = "73ed9aae-8526-46ca-a70e-a70eef87c456"

type issuance struct {
	PublicKey string    `json:"clientPublicKey"`
	ExpiresAt time.Time `json:"expiresAt"`
	IssuedAt  time.Time `json:"issuedAt"`
}

type registry struct {
	sync.Mutex
	issued []issuance
}

func (r *registry) Register(_ context.Context, session streammessages.Session) error {
	r.Lock()
	defer r.Unlock()
	r.issued = append(r.issued, issuance{session.PublicKey, session.ExpiresAt, time.Now().UTC()})
	return nil
}

type broker struct {
	sync.Mutex
	binary, config, monitor string
	log                     *os.File
	cmd                     *exec.Cmd
	done                    chan error
}

func (b *broker) start() error {
	b.Lock()
	defer b.Unlock()
	if b.cmd != nil {
		return nil
	}
	cmd := exec.Command(b.binary, "-c", b.config)
	cmd.Stdout, cmd.Stderr = b.log, b.log
	if err := cmd.Start(); err != nil {
		return err
	}
	b.cmd, b.done = cmd, make(chan error, 1)
	go func() { b.done <- cmd.Wait() }()
	deadline := time.Now().Add(5 * time.Second)
	client := &http.Client{Timeout: 200 * time.Millisecond}
	for time.Now().Before(deadline) {
		select {
		case err := <-b.done:
			b.cmd = nil
			return fmt.Errorf("NATS exited during startup: %v", err)
		default:
		}
		res, err := client.Get(b.monitor + "/varz")
		if err == nil {
			res.Body.Close()
			if res.StatusCode == http.StatusOK {
				return nil
			}
		}
		time.Sleep(20 * time.Millisecond)
	}
	_ = cmd.Process.Kill()
	<-b.done
	b.cmd = nil
	return errors.New("NATS startup deadline exceeded")
}

func (b *broker) stop() {
	b.Lock()
	defer b.Unlock()
	if b.cmd == nil {
		return
	}
	_ = b.cmd.Process.Signal(os.Interrupt)
	select {
	case <-b.done:
	case <-time.After(3 * time.Second):
		_ = b.cmd.Process.Kill()
		<-b.done
	}
	b.cmd = nil
}

func port() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

func certificate(dir string) (string, string, error) {
	pub, key, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return "", "", err
	}
	serial, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return "", "", err
	}
	template := &x509.Certificate{
		SerialNumber: serial, Subject: pkix.Name{CommonName: "Tier0 local NATS fixture"},
		NotBefore: time.Now().Add(-time.Minute), NotAfter: time.Now().Add(time.Hour),
		IPAddresses: []net.IP{net.ParseIP("127.0.0.1")}, DNSNames: []string{"localhost"},
		IsCA: true, BasicConstraintsValid: true,
		KeyUsage:    x509.KeyUsageDigitalSignature | x509.KeyUsageCertSign,
		ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}
	der, err := x509.CreateCertificate(rand.Reader, template, template, pub, key)
	if err != nil {
		return "", "", err
	}
	private, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		return "", "", err
	}
	certPath, keyPath := filepath.Join(dir, "ca.pem"), filepath.Join(dir, "tls-key.pem")
	if err = os.WriteFile(certPath, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0600); err != nil {
		return "", "", err
	}
	err = os.WriteFile(keyPath, pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: private}), 0600)
	return certPath, keyPath, err
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func run() error {
	dir := flag.String("dir", "", "private temporary fixture directory")
	binary := flag.String("nats-server", "nats-server", "native NATS server binary")
	topic := flag.String("topic", "sdk/contract", "fixed authorized logical topic")
	flag.Parse()
	if *dir == "" || !streammessages.ValidTopic(*topic) {
		return errors.New("fixture directory and valid topic required")
	}
	operator, err := nkeys.CreateOperator()
	if err != nil {
		return err
	}
	defer operator.Wipe()
	account, err := nkeys.CreateAccount()
	if err != nil {
		return err
	}
	defer account.Wipe()
	system, err := nkeys.CreateAccount()
	if err != nil {
		return err
	}
	defer system.Wipe()
	opPub, err := operator.PublicKey()
	if err != nil {
		return err
	}
	accountPub, err := account.PublicKey()
	if err != nil {
		return err
	}
	systemPub, err := system.PublicKey()
	if err != nil {
		return err
	}
	opClaim := jwt.NewOperatorClaims(opPub)
	opClaim.SystemAccount = systemPub
	opJWT, err := opClaim.Encode(operator)
	if err != nil {
		return err
	}
	accountJWT, err := jwt.NewAccountClaims(accountPub).Encode(operator)
	if err != nil {
		return err
	}
	systemJWT, err := jwt.NewAccountClaims(systemPub).Encode(operator)
	if err != nil {
		return err
	}
	tcp, err := port()
	if err != nil {
		return err
	}
	ws, err := port()
	if err != nil {
		return err
	}
	monitor, err := port()
	if err != nil {
		return err
	}
	certPath, keyPath, err := certificate(*dir)
	if err != nil {
		return err
	}
	config := map[string]any{
		"listen": fmt.Sprintf("127.0.0.1:%d", tcp), "http": fmt.Sprintf("127.0.0.1:%d", monitor),
		"operator": opJWT, "system_account": systemPub,
		"resolver":         map[string]any{"type": "full", "dir": filepath.Join(*dir, "resolver")},
		"resolver_preload": map[string]string{accountPub: accountJWT, systemPub: systemJWT},
		"websocket": map[string]any{"listen": fmt.Sprintf("127.0.0.1:%d", ws),
			"tls": map[string]any{"cert_file": certPath, "key_file": keyPath}},
	}
	raw, err := json.Marshal(config)
	if err != nil {
		return err
	}
	configPath := filepath.Join(*dir, "nats.conf")
	if err = os.WriteFile(configPath, raw, 0600); err != nil {
		return err
	}
	log, err := os.OpenFile(filepath.Join(*dir, "broker.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer log.Close()
	b := &broker{binary: *binary, config: configPath, monitor: fmt.Sprintf("http://127.0.0.1:%d", monitor), log: log}
	if err = b.start(); err != nil {
		return err
	}
	defer b.stop()
	seed, err := account.Seed()
	if err != nil {
		return err
	}
	reg := &registry{}
	issuer, err := streammessages.NewIssuer(streammessages.IssuerConfig{
		WebSocketURL: fmt.Sprintf("wss://127.0.0.1:%d", ws), AccountSeed: seed,
		TTL: 10 * time.Second, Registry: reg,
	})
	if err != nil {
		return err
	}
	defer issuer.Close()
	defer func() {
		for index := range seed {
			seed[index] = 0
		}
	}()
	// Identity and authority are fixture-owned, never derived from request fields.
	authority := streammessages.Authority{
		WorkspaceID: 42, AppID: appID, Principal: "app:fixture:employee-17",
		ResourceKeys: []string{streammessages.PublishResource, streammessages.SubscribeResource},
		Topics:       []streammessages.TopicPermission{{Topic: *topic, Publish: true, Subscribe: true}},
	}
	mux := http.NewServeMux()
	mux.HandleFunc("POST /openapi/v2/stream-messages/connect", func(w http.ResponseWriter, r *http.Request) {
		var request streammessages.ConnectRequest
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16*1024))
		decoder.DisallowUnknownFields()
		if decoder.Decode(&request) != nil || decoder.Decode(new(any)) != io.EOF {
			writeJSON(w, 400, map[string]string{"errorCode": "STREAM_MESSAGE_INVALID_INPUT"})
			return
		}
		connection, err := issuer.Issue(r.Context(), request, authority)
		if err != nil {
			writeJSON(w, 403, map[string]string{"errorCode": "STREAM_MESSAGE_FORBIDDEN"})
			return
		}
		writeJSON(w, 200, connection)
	})
	mux.HandleFunc("POST /__fixture/broker/stop", func(w http.ResponseWriter, r *http.Request) {
		b.stop()
		writeJSON(w, 200, map[string]bool{"running": false})
	})
	mux.HandleFunc("POST /__fixture/broker/start", func(w http.ResponseWriter, r *http.Request) {
		if err := b.start(); err != nil {
			writeJSON(w, 500, map[string]string{"error": "NATS startup failed"})
			return
		}
		writeJSON(w, 200, map[string]bool{"running": true})
	})
	mux.HandleFunc("GET /__fixture/stats", func(w http.ResponseWriter, r *http.Request) {
		reg.Lock()
		issued := append([]issuance{}, reg.issued...)
		reg.Unlock()
		var connz struct {
			NumConnections int `json:"num_connections"`
			Connections    []struct {
				Subscriptions int `json:"subscriptions"`
			} `json:"connections"`
		}
		client := &http.Client{Timeout: 500 * time.Millisecond}
		res, err := client.Get(b.monitor + "/connz")
		if err != nil {
			writeJSON(w, 503, map[string]any{"issued": issued, "running": false})
			return
		}
		defer res.Body.Close()
		if json.NewDecoder(res.Body).Decode(&connz) != nil {
			writeJSON(w, 500, map[string]string{"error": "invalid monitoring response"})
			return
		}
		subscriptions := 0
		for _, connection := range connz.Connections {
			subscriptions += connection.Subscriptions
		}
		writeJSON(w, 200, map[string]any{"issued": issued, "running": true,
			"connections": connz.NumConnections, "subscriptions": subscriptions})
	})
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return err
	}
	url := "http://" + listener.Addr().String()
	manifest := map[string]any{"url": url, "controlUrl": url, "caPath": certPath, "appId": appID, "topic": *topic, "ttlMs": 10_000}
	raw, err = json.Marshal(manifest)
	if err != nil {
		return err
	}
	if err = os.WriteFile(filepath.Join(*dir, "ready.json"), raw, 0600); err != nil {
		return err
	}
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 2 * time.Second}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	select {
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	case err := <-done:
		return err
	}
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "native Stream messages fixture:", err)
		os.Exit(1)
	}
}
