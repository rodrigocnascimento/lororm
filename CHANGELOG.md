# Changelog

Todas as mudanças notáveis deste projeto serão documentadas neste arquivo.

O formato é baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.0.0/),
e este projeto adere a [Semantic Versioning](https://semver.org/lang/pt-BR/).

---

## [0.1.0] - 2026-05-12

### Adicionado

- **Core**: API pública `LoRORM<TSchema>()` com tipagem forte via TypeScript generics.
- **CRUD completo**: métodos `insert`, `findById`, `update`, `delete`, `deleteOK` e acesso direto via `data`.
- **Persistência reativa**: Proxy recursivo que intercepta mutações (`set`, `deleteProperty`, `defineProperty`) e salva automaticamente em JSON.
- **Escrita atômica**: estratégia "write-to-temp-then-rename" para evitar corrupção de `db.json`.
- **Indexação O(1)**: mapas `Map<string, Entity>` reconstruídos automaticamente a cada mutação para buscas por `id` em tempo constante.
- **Documentação**: `README.md` com diagramas Mermaid e `documentation.md` com referência técnica completa.
- **Build**: suporte a Bun + TypeScript com declarações de tipo (`dist/index.d.ts`).

### Notas

- Versão inicial. API considerada estável para uso em protótipos e MVPs.
- O pacote não possui dependências de runtime.
