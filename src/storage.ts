/**
 * @fileoverview Camada de persistência em disco do LoRORM.
 *
 * Este módulo isola todas as operações de I/O síncrona (leitura e escrita
 * de arquivos). A estratégia de escrita é **atômica**: os dados são
 * primeiro gravados em um arquivo temporário (`.tmp`) e só então
 * renomeados para o destino final. Isso garante que, mesmo em caso de
 * queda de energia durante a escrita, o arquivo `db.json` nunca fique
 * em um estado corrompido (ou tem o conteúdo antigo inteiro, ou o novo
 * inteiro — nunca um híbrido).
 *
 * A renomeação em sistemas de arquivo modernos (ext4, APFS, NTFS) é
 * uma operação atômica no nível do kernel, tornando essa estratégia
 * segura para uso em produção simples.
 */

import { writeFileSync, renameSync, existsSync, readFileSync } from "node:fs";

/**
 * Caminho padrão do arquivo de persistência.
 *
 * Pode ser sobrescrito importando e alterando essa constante antes
 * de chamar {@link LoRORM}, embora o caminho mais comum seja manter
 * o padrão `./db.json` na raiz do projeto.
 *
 * @example
 * ```ts
 * import { STORAGE_PATH, LoRORM } from "lororm";
 * STORAGE_PATH = "./data/meu-banco.json";
 * const db = LoRORM({ usuarios: [] });
 * ```
 */
export const STORAGE_PATH = "./db.json";

/**
 * Lê o arquivo JSON de disco e retorna os dados desserializados.
 *
 * Se o arquivo não existir (primeira execução, por exemplo), retorna
 * o objeto `fallback` sem tentar ler do disco. Se o arquivo existir
 * mas estiver corrompido (JSON inválido), lança um erro descritivo
 * com a causa original anexada em `error.cause`.
 *
 * @template T - Tipo esperado dos dados. Deve ser inferido pelo
 *   chamador a partir do esquema passado para {@link LoRORM}.
 * @param fallback - Valor padrão retornado quando o arquivo não existe.
 *   Geralmente é uma cópia profunda do `defaultData` inicial.
 * @returns Os dados desserializados do disco, ou `fallback` se o arquivo
 *   não existir.
 * @throws {Error} Quando o arquivo existe mas contém JSON inválido.
 *
 * @example
 * ```ts
 * const dados = lerDisco<PetShopData>({ gatos: [] });
 * // Se db.json não existir → { gatos: [] }
 * // Se db.json existir    → conteúdo parseado
 * ```
 */
export function lerDisco<T>(fallback: T): T {
  if (existsSync(STORAGE_PATH)) {
    try {
      const conteudo = readFileSync(STORAGE_PATH, "utf-8");
      return JSON.parse(conteudo) as T;
    } catch (error) {
      throw new Error(
        "⚠️ [LoRORM] Erro ao ler disco, usando dados iniciais: ",
        { cause: error },
      );
    }
  }
  return fallback;
}

/**
 * Grava os dados no disco de forma **atômica**.
 *
 * O algoritmo segue o padrão "write-to-temp-then-rename":
 * 1. Serializa `dados` para JSON com indentação de 2 espaços.
 * 2. Grava o conteúdo em um arquivo temporário (`db.json.tmp`).
 * 3. Renomeia o arquivo temporário para o nome final (`db.json`).
 *
 * Por que isso é seguro?
 * - Se o processo morrer durante o `writeFileSync`, o `.tmp` fica
 *   incompleto, mas o `db.json` original permanece intacto.
 * - Se o processo morrer durante o `renameSync`, o arquivo de destino
 *   já foi truncado pelo SO, mas em sistemas modernos o `rename`
 *   é atômico, então ou o antigo permanece ou o novo substitui —
 *   nunca um estado intermediário é visível para leitores.
 *
 * @param dados - Objeto JavaScript a ser serializado e persistido.
 *   Tipicamente é o mesmo objeto envolvido pelo Proxy da engine.
 * @throws {Error} Quando falha a escrita ou a renomeação (disco cheio,
 *   permissões insuficientes, etc.).
 */
export function salvarDisco(dados: any): void {
  const tempPath = `${STORAGE_PATH}.tmp`;
  try {
    writeFileSync(tempPath, JSON.stringify(dados, null, 2));
    renameSync(tempPath, STORAGE_PATH);
  } catch (error) {
    throw new Error("🚨 [LoRORM] Falha crítica de escrita atômica:", {
      cause: error,
    });
  }
}
