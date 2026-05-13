/**
 * @fileoverview Tipos fundamentais do LoRORM.
 *
 * Este módulo define as interfaces e type aliases que garantem a segurança
 * de tipos em toda a biblioteca. O contrato central é simples: toda entidade
 * armazenada deve possuir uma propriedade `id` do tipo `string`. A partir
 * desse contrato, o TypeScript infere automaticamente os mapas de índice,
 * as coleções e as assinaturas de método.
 */

/**
 * Contrato mínimo de uma entidade persistível no LoRORM.
 *
 * A única exigência é a presença de um campo `id` do tipo `string`.
 * Todas as demais propriedades são livres (index signature `[key: string]: any`).
 *
 * @example
 * ```ts
 * const gato: Entity = {
 *   id: "046d57bc-af27-4d20-b879-8d715ea81461",
 *   nome: "Margot",
 *   raca: "SRD",
 *   status: "adotado",
 * };
 * ```
 */
export interface Entity {
  /** Identificador único da entidade. Deve ser único dentro da sua coleção. */
  id: string;
  /** Propriedades adicionais livres. */
  [key: string]: any;
}

/**
 * Esquema genérico aceito pelo LoRORM.
 *
 * Um esquema é um objeto cujas chaves são os nomes das coleções e cujos
 * valores são arrays de {@link Entity}. Essa estrutura reflete exatamente
 * o formato do arquivo JSON persistido em disco.
 *
 * @example
 * ```ts
 * type PetShopSchema = {
 *   gatos: Array<{ id: string; nome: string; raca: string; status: string }>;
 *   cachorros: Array<{ id: string; nome: string; raca: string }>;
 * };
 * ```
 */
export type GenericSchema = Record<string, Entity[]>;

/**
 * Mapa tipado de índices gerado a partir de um esquema.
 *
 * Para cada chave `K` do esquema, cria-se um `Map<string, T[K][number]>`,
 * onde a chave do Map é o `id` da entidade e o valor é a própria entidade.
 * Esse tipo é o que permite que `findById` retorne o tipo correto sem
 * necessidade de cast manual.
 *
 * @template T - Esquema que estende {@link GenericSchema}.
 *
 * @example
 * ```ts
 * type Indices = IndexMap<PetShopSchema>;
 * // Equivalente a:
 * // {
 * //   gatos: Map<string, { id: string; nome: string; ... }>;
 * //   cachorros: Map<string, { id: string; nome: string; ... }>;
 * // }
 * ```
 */
export type IndexMap<T extends GenericSchema> = {
  [K in keyof T]: Map<string, T[K][number]>;
};

/**
 * Versão "bruta" (não tipada) do mapa de índices.
 *
 * Usado internamente pela {@link Engine} (engine.ts) para evitar
 * poluição de generics em baixo nível. A engine não precisa saber
 * os tipos específicos das entidades — ela só precisa sincronizar
 * Maps de string → any. A tipagem forte é restaurada na API pública
 * em {@link LoRORM}.
 */
export type RawIndexMap = Record<string, Map<string, any>>;
