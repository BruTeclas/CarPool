# Publicação na Hostinger (zentrega.com.br)

O app é estático (React + Vite). O banco e o login ficam no Supabase; a Hostinger só serve os arquivos.

## Gerar o pacote
```bash
cd app
npm ci
npm run build   # gera app/dist
```
O conteúdo de `app/dist` (incluindo o `.htaccess`) é o que vai para o servidor. As variáveis públicas vêm de `app/.env.production`.

## Subir
1. hPanel da Hostinger → Sites → zentrega.com.br → Gerenciador de Arquivos → `public_html`.
2. Apague o conteúdo padrão e envie **o conteúdo** de `dist` (não a pasta). Confirme que `.htaccess` apareceu (ative "mostrar arquivos ocultos").
3. Em SSL, ative o certificado gratuito do domínio.
4. Abra https://zentrega.com.br.

## Depois de publicar
- Supabase → Authentication → URL Configuration: **Site URL** = `https://zentrega.com.br` e adicione a mesma URL em Redirect URLs.
- Supabase → Authentication → Providers/Password: ligue a proteção contra senhas vazadas.
- Crie o primeiro usuário em Authentication → Users e vincule a uma empresa (ver `supabase/README.md`).
- Os usuários de teste do `seed.sql` **não existem mais** no projeto. Não rode o seed em produção.

## Cloudflare Pages (escolhido em 16/11/2026)

Publicação ligada ao GitHub: cada envio para `main` publica sozinho.

1. Painel do Cloudflare → **Workers & Pages** → **Create** → aba **Pages** → **Connect to Git**.
2. Autorizar o GitHub e escolher o repositório `BruTeclas/CarPool`.
3. Configuração do build:
   - Production branch: `main`
   - Framework preset: `None` (ou `Vite`)
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: `app`
   - Variáveis: nenhuma é obrigatória (a URL e a chave publicável do Supabase estão em `app/.env.production`, são públicas por desenho). Opcional: `NODE_VERSION=22` (o `app/.nvmrc` já pede a 22).
4. **Save and Deploy**. O site sai em `https://<nome-do-projeto>.pages.dev`.
5. Domínio próprio: no projeto, **Custom domains** → `carpool.zentrega.com.br` (ou outro). Como o DNS de `zentrega.com.br` está na Hostinger, criar lá um registro **CNAME** `carpool` → `<nome-do-projeto>.pages.dev`. O HTTPS sai automático.
6. Supabase → **Authentication → URL Configuration**: colocar o endereço final em **Site URL** e em **Redirect URLs** (links de troca de senha).

Se o painel abrir o fluxo de **Workers** (campos "Comando de implantação" e "Comando de visualização"), também funciona: o `app/wrangler.jsonc` já está pronto. Preencher: diretório raiz `app`, build `npm run build`, implantação `npx wrangler deploy`, visualização `npx wrangler versions upload`.

`app/public/_headers` define os cabeçalhos de segurança e o cache do service worker. Sem `404.html`, o Pages devolve o `index.html` para qualquer rota (o React Router cuida do resto).
