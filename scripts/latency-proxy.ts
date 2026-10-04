// TCP proxy that delays traffic in both directions (default 65 ms each way ≈ 130 ms RTT).
// Usage: tsx scripts/latency-proxy.ts <listenPort> <targetPort> [delayMs]
import net from "node:net";
const [listen, target, delay = "65"] = process.argv.slice(2).map(String);
const d = Number(delay);
net.createServer((client) => {
  const upstream = net.connect(Number(target), "127.0.0.1");
  const pipe = (from: net.Socket, to: net.Socket) => from.on("data", (chunk) => setTimeout(() => to.writable && to.write(chunk), d));
  pipe(client, upstream);
  pipe(upstream, client);
  const end = () => { client.destroy(); upstream.destroy(); };
  client.on("close", end); upstream.on("close", end); client.on("error", end); upstream.on("error", end);
}).listen(Number(listen), () => console.log(`latency proxy :${listen} -> :${target} (+${d} ms each way)`));
