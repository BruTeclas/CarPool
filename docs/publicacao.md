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
