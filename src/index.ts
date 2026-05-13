/**
 * @fileoverview API pública do LoRORM — Lord of Reactivity ORM.
 *
 * O LoRORM é um "ORM" híbrido que combina:
 * - **Memória RAM** como camada primária (acesso instantâneo).
 * - **Arquivo JSON** como camada de persistência (via Proxy reativo).
 * - **Índices Hash** (`Map<string, Entity>`) para buscas por `id` em O(1).
 *
 * A API é deliberadamente minimalista: `insert`, `findById`, `update`,
 * `delete` e `data` (acesso direto ao proxy). Não há query builder,
 * não há migrations, não há conexões — apenas um objeto JavaScript
 * que se salva sozinho.
 *
 * ## Ciclo de vida típico
 *
 * ```
 * 1. LoRORM({ gatos: [] })
 *    └─→ lerDisco() → lê db.json (ou usa fallback)
 *    └─→ cria índices Map para cada coleção
 *    └─→ cria Proxy recursivo → intercepta mutações
 *
 * 2. db.insert("gatos", { id: "1", nome: "Loro" })
 *    └─→ push no array (mutação detectada pelo Proxy)
 *    └─→ engine atualiza índice Map
 *    └─→ salvarDisco() → grava db.json atomicamente
 *
 * 3. db.findById("gatos", "1")
 *    └─→ Map.get("1") → O(1) → retorna a entidade
 * ```
 */

import { GenericSchema, IndexMap, RawIndexMap } from "./types";
import { lerDisco, salvarDisco } from "./storage";
import { criarProxyDeep } from "./engine";

/**
 * Inicializa uma instância do LoRORM.
 *
 * Esta é a única função que o usuário precisa chamar. Ela orquestra
 * três responsabilidades:
 *
 * 1. **Hidratação**: lê `db.json` do disco (ou usa `defaultData`).
 * 2. **Indexação**: constrói `Map`s de `id` → entidade para cada coleção.
 * 3. **Reatividade**: envolve o objeto em um {@link Proxy} recursivo
 *    que salva automaticamente no disco a cada mutação.
 *
 * @template TSchema - Tipo do esquema. Deve ser um `Record` cujos
 *   valores são arrays de objetos com pelo menos um campo `id: string`.
 * @param defaultData - Estrutura padrão do banco. Usada quando o
 *   arquivo `db.json` não existe (primeira execução).
 * @returns Objeto com métodos CRUD e acesso direto ao proxy reativo.
 *
 * @example
 * ```ts
 * import { LoRORM } from "lororm";
 *
 * type PetShop = {
 *   gatos: Array<{ id: string; nome: string; raca: string; status: string }>;
 * };
 *
 * const db = LoRORM<PetShop>({ gatos: [] });
 *
 * // Inserir
 * db.insert("gatos", { id: crypto.randomUUID(), nome: "Loro", raca: "SRD", status: "adotado" });
 *
 * // Buscar
 * const gato = db.findById("gatos", "046d57bc-af27-4d20-b879-8d715ea81461");
 *
 * // Acesso direto (mutações são salvas automaticamente)
 * db.data.gatos[0].nome = "Margot";
 * ```
 */
export function LoRORM<TSchema extends GenericSchema>(defaultData: TSchema) {
  // ─── 1. HIDRATAÇÃO ─────────────────────────────────────────────────────
  // Tenta ler db.json. Se não existir, usa o defaultData.
  // O tipo TSchema garante que o retorno seja estruturalmente compatível.
  const dadosAtuais = lerDisco<TSchema>(defaultData);

  // ─── 2. INDEXAÇÃO ──────────────────────────────────────────────────────
  // Para cada coleção no esquema, cria um Map vazio e preenche com
  // os itens já existentes no disco. Isso garante que findById funcione
  // imediatamente, mesmo para dados antigos.
  const indices = {} as IndexMap<TSchema>;

  for (const chave in defaultData) {
    indices[chave] = new Map();
    dadosAtuais[chave].forEach((item: any) => {
      indices[chave].set(item.id, item);
    });
  }

  // ─── 3. REATIVIDADE ────────────────────────────────────────────────────
  // Cria o Proxy recursivo. O callback `aoMudar` é executado a cada
  // mutação (set, delete, defineProperty) em qualquer nível do objeto.
  //
  // O callback faz duas coisas:
  // a) Reconstrói os índices do zero a partir do array real. Isso garante
  //    consistência absoluta mesmo após operações complexas como splice.
  // b) Persiste os dados no disco via salvarDisco() (escrita atômica).
  const db = criarProxyDeep(
    dadosAtuais,
    () => {
      for (const chave in defaultData) {
        if (Array.isArray(dadosAtuais[chave])) {
          indices[chave].clear();
          for (const item of dadosAtuais[chave]) {
            if (item && typeof item === "object" && "id" in item) {
              indices[chave].set(item.id, item);
            }
          }
        }
      }
      salvarDisco(dadosAtuais);
    },
    indices as RawIndexMap,
  );

  // ─── 4. API PÚBLICA ────────────────────────────────────────────────────
  return {
    /**
     * Insere uma nova entidade no final da coleção.
     *
     * Internamente faz `db[collection].push(item)`. O Proxy detecta
     * a mutação e dispara a persistência automaticamente.
     *
     * @template K - Nome da coleção, inferido do esquema.
     * @param collection - Nome da coleção (ex: `"gatos"`).
     * @param item - Entidade a ser inserida. Deve conter `id`.
     *
     * @example
     * ```ts
     * db.insert("gatos", { id: "1", nome: "Loro", raca: "SRD", status: "livre" });
     * ```
     */
    insert: <K extends keyof TSchema>(
      collection: K,
      item: TSchema[K][number],
    ) => {
      (db[collection] as any[]).push(item);
    },

    /**
     * Busca uma entidade pelo `id` em tempo constante O(1).
     *
     * Usa o índice `Map` interno em vez de percorrer o array.
     * Se não encontrar, retorna `null`.
     *
     * @template K - Nome da coleção, inferido do esquema.
     * @param collection - Nome da coleção.
     * @param id - Identificador único da entidade.
     * @returns A entidade encontrada, ou `null`.
     *
     * @example
     * ```ts
     * const gato = db.findById("gatos", "046d57bc-af27-4d20-b879-8d715ea81461");
     * if (gato) console.log(gato.nome);
     * ```
     */
    findById: <K extends keyof TSchema>(collection: K, id: string) => {
      return (
        (indices[collection] as Map<string, TSchema[K][number]>).get(id) || null
      );
    },

    /**
     * Substitui uma entidade existente pelo `id`.
     *
     * Localiza o índice no array e substitui o item inteiro.
     * Se o `id` não existir, a operação é silenciosamente ignorada.
     *
     * @template K - Nome da coleção.
     * @param collection - Nome da coleção.
     * @param id - Identificador da entidade a ser substituída.
     * @param item - Nova entidade (pode ter `id` diferente do parâmetro).
     *
     * @example
     * ```ts
     * db.update("gatos", "1", { id: "1", nome: "Loro Atualizado", raca: "SRD", status: "adotado" });
     * ```
     */
    update: <K extends keyof TSchema>(
      collection: K,
      id: string,
      item: TSchema[K][number],
    ) => {
      const index = (db[collection] as any[]).findIndex((i) => i.id === id);
      if (index !== -1) {
        (db[collection] as any[])[index] = item;
      }
    },

    /**
     * Remove uma entidade pelo `id` usando `Array.prototype.splice()`.
     *
     * **Atenção**: este método usa `splice` internamente, o que pode
     * deixar o índice `Map` desincronizado em versões anteriores do
     * LoRORM que não implementavam a trap `defineProperty`. Na versão
     * atual, a reconstrução de índices no callback `aoMudar` garante
     * consistência. Para deleção segura com log, prefira {@link deleteOK}.
     *
     * @template K - Nome da coleção.
     * @param collection - Nome da coleção.
     * @param id - Identificador da entidade a ser removida.
     */
    deleteNOTOK: <K extends keyof TSchema>(collection: K, id: string) => {
      const item = (db[collection] as any[]).find((i) => i.id === id);
      if (item) {
        (db[collection] as any[]).splice(
          (db[collection] as any[]).indexOf(item),
          1,
        );
      }
    },

    /**
     * Remove uma entidade pelo `id` com verificação de existência e log.
     *
     * Este é o método recomendado para deleções. Ele:
     * 1. Busca o índice real no array via `findIndex`.
     * 2. Se encontrar, remove com `splice`.
     * 3. Emite um log de sucesso ou warning no console.
     *
     * @template K - Nome da coleção.
     * @param collection - Nome da coleção.
     * @param id - Identificador da entidade a ser removida.
     *
     * @example
     * ```ts
     * db.delete("gatos", "046d57bc-af27-4d20-b879-8d715ea81461");
     * // → 🐈 Loro removeu o item ... da coleção gatos
     * ```
     */
    delete: <K extends keyof TSchema>(collection: K, id: string) => {
      const index = (db[collection] as any[]).findIndex(
        (i) => String(i.id) === String(id),
      );

      if (index !== -1) {
        (db[collection] as any[]).splice(index, 1);
        console.log(
          `🐈 Loro removeu o item ${id} da coleção ${String(collection)}`,
        );
      } else {
        console.warn(`😿 Loro não achou o id ${id} para deletar.`);
      }
    },

    /**
     * Remove uma entidade por qualquer coluna (não apenas `id`).
     *
     * Útil quando você precisa deletar por uma chave estrangeira ou
     * por qualquer outro campo único. A comparação é feita com
     * `String(i[column]) === String(id)`, então funciona com números
     * e strings indistintamente.
     *
     * @template K - Nome da coleção.
     * @param collection - Nome da coleção.
     * @param id - Valor a ser comparado.
     * @param column - Nome da propriedade a ser usada na comparação.
     *
     * @example
     * ```ts
     * db.deleteOK("gatos", "adotado", "status");
     * // Remove o primeiro gato com status "adotado"
     * ```
     */
    deleteOK: <K extends keyof TSchema>(
      collection: K,
      id: string,
      column: string,
    ) => {
      const index = (db[collection] as any[]).findIndex(
        (i) => String(i[column]) === String(id),
      );

      if (index !== -1) {
        (db[collection] as any[]).splice(index, 1);
        console.log(
          `🐈 Loro removeu o item ${id} da coleção ${String(collection)}`,
        );
      } else {
        console.warn(`😿 Loro não achou o id ${id} para deletar.`);
      }
    },

    /**
     * Acesso direto ao objeto de dados envolvido pelo Proxy.
     *
     * Qualquer mutação feita através de `db.data` é automaticamente
     * detectada e persistida. Isso permite operações avançadas que
     * não têm método dedicado (filter, map, sort, etc.).
     *
     * @example
     * ```ts
     * // Alteração direta (salva automaticamente)
     * db.data.gatos[0].nome = "Novo Nome";
     *
     * // Leitura direta
     * const todos = db.data.gatos;
     * ```
     */
    data: db,
  };
}

// Re-exportações para conveniência do consumidor.
export * from "./types";
export { STORAGE_PATH } from "./storage";
