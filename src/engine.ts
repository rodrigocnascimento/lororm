/**
 * @fileoverview Motor de reatividade do LoRORM.
 *
 * A engine é o coração da biblioteca. Ela envolve o objeto de dados
 * em um {@link Proxy} recursivo que intercepta **todas** as operações
 * de mutação: atribuição de propriedades (`set`), deleção de propriedades
 * (`deleteProperty`) e redefinição de descritores (`defineProperty`).
 *
 * Por que recursivo? Porque os dados são aninhados:
 * ```
 * { gatos: [ { id: "...", nome: "..." } ] }
 *   ^objeto raiz  ^array    ^objeto entidade
 * ```
 * A engine precisa interceptar mutações em **qualquer** nível da árvore.
 * Quando você faz `db.gatos[0].nome = "Novo"`, o `set` dispara no Proxy
 * do objeto entidade, que chama `aoMudar()`, que salva o JSON.
 *
 * ## Sincronização de Índices
 *
 * Além de salvar no disco, a engine mantém os índices em memória
 * sincronizados com o array real. Isso é crítico para que
 * `findById` continue em O(1) mesmo após mutações complexas como
 * `Array.prototype.splice()`.
 *
 * ## Por que `defineProperty` é necessário?
 *
 * `Array.prototype.splice()` não usa apenas `set`/`deleteProperty`.
 * Internamente, o ECMAScript chama `[[DefineOwnProperty]]` para
 * reconfigurar os índices do array após a remoção/inserção.
 * Sem a trap `defineProperty`, o índice `Map` ficaria desincronizado
 * do array real após operações como `splice` ou `shift`.
 */

import { RawIndexMap } from "./types";

/**
 * Cria um Proxy recursivo que monitora mutações em qualquer nível
 * do objeto de dados e sincroniza os índices em memória.
 *
 * @template T - Tipo do objeto raiz (tipicamente o esquema completo).
 * @param objeto - Objeto a ser envolvido pelo Proxy. Tipicamente o
 *   objeto retornado por {@link lerDisco}.
 * @param aoMudar - Callback executado **sempre que uma mutação for
 *   detectada**. No LoRORM, esse callback reconstrói os índices e
 *   chama {@link salvarDisco}.
 * @param indices - Mapa bruto de índices (`RawIndexMap`). Cada chave
 *   é o nome da coleção e cada valor é um `Map<string, any>` indexado
 *   pelo `id` da entidade.
 * @returns O mesmo objeto, mas envolvido por um Proxy recursivo.
 *   A partir desse momento, qualquer mutação dispara `aoMudar()`.
 *
 * @example
 * ```ts
 * const indices = { gatos: new Map() };
 * const dados = { gatos: [{ id: "1", nome: "Loro" }] };
 * const proxy = criarProxyDeep(dados, () => console.log("Mudou!"), indices);
 * proxy.gatos[0].nome = "Margot"; // → "Mudou!"
 * ```
 */
export function criarProxyDeep<T extends object>(
  objeto: T,
  aoMudar: () => void,
  indices: RawIndexMap,
): T {
  return new Proxy(objeto, {
    /**
     * Trap `get` — intercepta leituras de propriedades.
     *
     * Quando o valor lido é um objeto (array ou objeto literal),
     * retornamos uma **nova** camada de Proxy. Isso garante que
     * mutações em objetos aninhados também sejam interceptadas.
     *
     * Nota: a recursão é lazy — cada nível da árvore só é envolvido
     * quando é acessado pela primeira vez.
     */
    get(target, prop) {
      const valor = Reflect.get(target, prop);

      if (valor && typeof valor === "object") {
        // Propaga os índices para baixo na recursão.
        // Todos os níveis compartilham o mesmo objeto `indices`.
        return criarProxyDeep(valor, aoMudar, indices);
      }

      return valor;
    },

    /**
     * Trap `set` — intercepta atribuições de propriedades.
     *
     * Fluxo:
     * 1. Compara o valor atual com o novo (evita triggers desnecessários).
     * 2. Se o valor novo for uma entidade (tem `id`), atualiza o índice.
     * 3. Dispara `aoMudar()` para persistir no disco.
     *
     * A verificação `Array.isArray(target)` garante que só indexamos
     * itens dentro de arrays de coleção — não indexamos propriedades
     * soltas do objeto raiz.
     */
    set(target, prop, valor) {
      const valorAtual = Reflect.get(target, prop);

      // Ignora atribuições idênticas (referencial ou primitivamente).
      if (valorAtual !== valor) {
        Reflect.set(target, prop, valor);

        // Se o valor atribuído é uma entidade (possui id),
        // atualiza o índice para buscas O(1).
        if (valor && typeof valor === "object" && "id" in valor) {
          for (const tabela in indices) {
            if (Array.isArray(target)) {
              indices[tabela].set(valor.id, valor);
            }
          }
        }

        aoMudar();
      }

      return true;
    },

    /**
     * Trap `deleteProperty` — intercepta o operador `delete`.
     *
     * Fluxo:
     * 1. Captura o valor que será removido (antes da deleção).
     * 2. Se o valor for uma entidade, remove seu `id` do índice.
     * 3. Executa a deleção real via `Reflect.deleteProperty`.
     * 4. Se a deleção teve sucesso, dispara `aoMudar()`.
     */
    deleteProperty(target, prop) {
      const valor = (target as any)[prop];

      if (valor && typeof valor === "object" && "id" in valor) {
        for (const tabela in indices) {
          indices[tabela].delete(valor.id);
        }
      }

      const sucesso = Reflect.deleteProperty(target, prop);
      if (sucesso) aoMudar();
      return sucesso;
    },

    /**
     * Trap `defineProperty` — intercepta `Object.defineProperty`.
     *
     * **Por que essa trap é crítica?**
     *
     * `Array.prototype.splice()` — usado internamente por `shift`,
     * `unshift`, `pop`, `push` e `splice` — não se limita a `set`
     * e `deleteProperty`. O algoritmo interno do ECMAScript chama
     * `[[DefineOwnProperty]]` para reconfigurar os índices do array
     * após a remoção ou inserção de elementos.
     *
     * Sem essa trap, o seguinte cenário quebraria o índice:
     * ```ts
     * db.gatos.splice(0, 1); // remove o primeiro gato
     * // O array agora tem novos índices, mas o Map ainda aponta
     * // para o gato removido. findById("gatos", id) retornaria null.
     * ```
     *
     * Fluxo da trap:
     * 1. Captura o valor anterior na posição.
     * 2. Executa `Reflect.defineProperty`.
     * 3. Se sucesso, captura o novo valor.
     * 4. Remove o `id` antigo do índice (se houver).
     * 5. Adiciona o `id` novo ao índice (se houver).
     * 6. Dispara `aoMudar()`.
     */
    defineProperty(target, prop, descriptor) {
      const valorAnterior = (target as any)[prop];
      const sucesso = Reflect.defineProperty(target, prop, descriptor);

      if (sucesso) {
        const novoValor = (target as any)[prop];

        // Remove a referência antiga do índice.
        if (
          valorAnterior &&
          typeof valorAnterior === "object" &&
          "id" in valorAnterior
        ) {
          for (const tabela in indices) {
            if (Array.isArray(target)) {
              indices[tabela].delete(valorAnterior.id);
            }
          }
        }

        // Adiciona a referência nova ao índice.
        if (
          novoValor &&
          typeof novoValor === "object" &&
          "id" in novoValor
        ) {
          for (const tabela in indices) {
            if (Array.isArray(target)) {
              indices[tabela].set(novoValor.id, novoValor);
            }
          }
        }

        aoMudar();
      }

      return sucesso;
    },
  });
}
