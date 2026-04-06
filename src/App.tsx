import { useState, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./styles/App.css";

/** Application shell — entry point for the Putz terminal emulator. */
function App() {
  const [greetMsg, setGreetMsg] = useState("");
  const [name, setName] = useState("");

  async function handleGreet(e: FormEvent) {
    e.preventDefault();
    const message = await invoke<string>("greet", { name });
    setGreetMsg(message);
  }

  return (
    <main className="app-container" data-testid="app-root">
      <h1>Welcome to Putz</h1>
      <p className="subtitle">
        A cross-platform terminal emulator built with Tauri
      </p>
      <span className="version-badge">v0.1.0</span>

      <form className="greet-form" onSubmit={handleGreet}>
        <input
          id="greet-input"
          onChange={(e) => setName(e.currentTarget.value)}
          placeholder="Enter a name..."
          aria-label="Name input"
        />
        <button type="submit">Greet</button>
      </form>
      <p className="greet-message" data-testid="greet-message">
        {greetMsg}
      </p>
    </main>
  );
}

export default App;
