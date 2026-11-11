# Identidade visual

O visual vem do assunto do produto: pátio, chave e placa. Qualquer tela nova segue estas escolhas.

- **Elemento de identidade:** a placa do veículo desenhada no padrão Mercosul (`components/Placa.tsx`). Sempre que um veículo aparece, usar `<Placa>` ou `<Veiculo>`, nunca a placa como texto solto.
- **Cores** (variáveis em `app/src/index.css`): asfalto `#1d2327` (menu e texto), concreto `#eef0ee` (fundo), branco (superfícies), azul de placa `#0b3d91` (ações), amarelo de faixa `#f2b705` (marcador do menu, foco e pendências), verde `#1f7a4d` e vermelho `#b3261e` (situações). Há modo escuro.
- **Letra:** Barlow no texto e Barlow Semi Condensed nos títulos, placas e códigos. As fontes vão junto com o app (`@fontsource`), sem depender de internet.
- **Layout:** menu lateral de asfalto agrupado em Uso, Operação e Cadastros; no celular vira o botão "Menu". Conteúdo alinhado à esquerda.
- **Situação da reserva:** componente `<Situacao>`, com cor por estado.
- **Evitar:** textos emendados com "·", rótulos em maiúsculas, sombras e gradientes decorativos, o mesmo arredondamento grande em tudo, setas "→" em botões.

Skills de apoio em `.claude/skills/`: `frontend-design` (direção e autocrítica), `impeccable` (revisão e polimento) e `ui-ux-pro-max` (referências de UX, paletas e tipografia).
