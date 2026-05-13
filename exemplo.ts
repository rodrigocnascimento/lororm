import { LoRORM } from "./src"; // O ponto de entrada da sua lib

// 1. O usuário define o Schema do banco dele (Totalmente desacoplado)
interface Gato {
  id: string;
  nome: string;
  raca: string;
  vidas: number;
}

interface Servidor {
  id: string;
  hostname: string;
  status: "online" | "offline";
}

type MyDatabase = {
  gatos: Gato[];
  servidores: Servidor[];
};

// 2. Inicializa o LoRORM passando o Schema e o estado inicial
const db = LoRORM<MyDatabase>({
  gatos: [],
  servidores: [],
});

// 3. Inserção Tipada (O TS garante que os campos batam)
db.insert("gatos", {
  id: "loro-01",
  nome: "Loro",
  raca: "Laranja",
  vidas: 7,
});

// db.delete

db.insert("servidores", {
  id: "srv-aws",
  hostname: "amazon-01",
  status: "online",
});

// 4. Busca Ultra-Rápida O(1) usando os Índices na RAM
console.time("Busca O(1)");
const meuGato = db.findById("gatos", "loro-01");
console.timeEnd("Busca O(1)");

meuGato?.vidas;

if (meuGato) {
  console.log(`Encontrado: ${meuGato.nome} (${meuGato.raca})`);
}

// 5. Reatividade Profunda (Deep Reactivity)
// Como usamos Proxy Recursivo, alterar uma propriedade aninhada salva no disco!
if (meuGato) {
  db.data.gatos[0].vidas = 6; // O Proxy detecta a mudança e chama salvarDisco()
}

// 6. Consultas (Queries)
const servidoresOffline = db.query(
  "servidores",
  (s: Servidor["status"]) => s.status === "offline",
);
console.log(`Servidores fora do ar: ${servidoresOffline.length}`);
