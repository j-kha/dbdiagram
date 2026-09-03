package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

var db *sql.DB

type Diagram struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	DBML      string `json:"dbml"`
	Positions string `json:"positions"` // JSON: { "table_name": { "x": 100, "y": 200 } }
	UpdatedAt string `json:"updated_at"`
	CreatedAt string `json:"created_at"`
}

func initDB() {
	var err error
	db, err = sql.Open("sqlite3", "./diagrams.db?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		log.Fatal(err)
	}
	db.Exec(`
		CREATE TABLE IF NOT EXISTS diagrams (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			dbml TEXT NOT NULL DEFAULT '',
			positions TEXT NOT NULL DEFAULT '{}',
			updated_at TEXT NOT NULL,
			created_at TEXT NOT NULL
		)
	`)
}

func listHandler(w http.ResponseWriter, r *http.Request) {
	rows, err := db.Query("SELECT id, name, dbml, positions, updated_at, created_at FROM diagrams ORDER BY updated_at DESC")
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()

	var diagrams []Diagram
	for rows.Next() {
		var d Diagram
		rows.Scan(&d.ID, &d.Name, &d.DBML, &d.Positions, &d.UpdatedAt, &d.CreatedAt)
		diagrams = append(diagrams, d)
	}
	if diagrams == nil {
		diagrams = []Diagram{}
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(diagrams)
}

func createHandler(w http.ResponseWriter, r *http.Request) {
	var d Diagram
	json.NewDecoder(r.Body).Decode(&d)
	if d.Name == "" {
		d.Name = "Untitled"
	}
	if d.Positions == "" {
		d.Positions = "{}"
	}
	now := time.Now().UTC().Format(time.RFC3339)
	result, err := db.Exec("INSERT INTO diagrams (name, dbml, positions, updated_at, created_at) VALUES (?, ?, ?, ?, ?)",
		d.Name, d.DBML, d.Positions, now, now)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	d.ID, _ = result.LastInsertId()
	d.CreatedAt = now
	d.UpdatedAt = now
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(201)
	json.NewEncoder(w).Encode(d)
}

func updateHandler(w http.ResponseWriter, r *http.Request) {
	var d Diagram
	json.NewDecoder(r.Body).Decode(&d)
	if d.ID == 0 {
		http.Error(w, "id required", 400)
		return
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := db.Exec("UPDATE diagrams SET name=?, dbml=?, positions=?, updated_at=? WHERE id=?",
		d.Name, d.DBML, d.Positions, now, d.ID)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	d.UpdatedAt = now
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(d)
}

func deleteHandler(w http.ResponseWriter, r *http.Request) {
	var body struct{ ID int64 `json:"id"` }
	json.NewDecoder(r.Body).Decode(&body)
	db.Exec("DELETE FROM diagrams WHERE id=?", body.ID)
	w.WriteHeader(204)
}

func main() {
	initDB()

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/diagrams", listHandler)
	mux.HandleFunc("POST /api/diagrams", createHandler)
	mux.HandleFunc("PUT /api/diagrams", updateHandler)
	mux.HandleFunc("DELETE /api/diagrams", deleteHandler)

	port := os.Getenv("PORT")
	if port == "" {
		port = "8085"
	}
	fmt.Printf("DB Diagram API running on :%s\n", port)
	log.Fatal(http.ListenAndServe(":"+port, mux))
}
