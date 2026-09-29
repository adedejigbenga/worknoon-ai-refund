import { useEffect, useState } from "react";

export function App() {
  const [api, setApi] = useState<string>("checking...");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: { status: string }) => setApi(d.status))
      .catch(() => setApi("unreachable"));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Refund Support</h1>
      <p>API status: {api}</p>
    </main>
  );
}
