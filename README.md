# CarPool

Sistema de reserva e controle de veículos compartilhados para empresas (corporate car sharing).

- `docs/estudo-funcional.md`: estudo funcional e de produto
- `docs/plano-mvp.md`: plano de construção do MVP
- `docs/plano-desenvolvimento.md`: plano de desenvolvimento por sprints
- `app/`: PWA em React + TypeScript + Vite
- `supabase/`: migrations e funções (a partir da Etapa 1)
- `.claude/skills/`: skills do projeto para o Claude Code

Desenvolvimento: `cd app && cp .env.example .env.local && npm install && npm run dev`.

## Graphify (grafo de conhecimento do código)

Skill `/graphify` instalada no projeto. Em outra máquina, instale a CLI uma vez: `uv tool install graphifyy`. Depois, no Claude Code, rode `/graphify .` para gerar o grafo em `graphify-out/`.
