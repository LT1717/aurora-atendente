# Aurora · Atendente IA no WhatsApp

Painel de atendimento para clínicas: uma assistente com IA responde no WhatsApp, consulta horários livres, faz agendamentos, envia lembrete na véspera e passa a conversa para a recepção quando é preciso. A equipe acompanha tudo num painel web.

> Projeto de demonstração com dados fictícios (Clínica Aurora Estética, São Paulo).

## Funcionalidades

- **Visão geral**: atendimentos do dia, quem ainda não confirmou, conversas aguardando a recepção e receita prevista.
- **Agenda semanal**: agendamentos por dia, estado (a confirmar, confirmado, concluído, cancelado, faltou), origem (WhatsApp ou painel) e registro do lembrete e da confirmação.
- **Novo agendamento** com horários livres calculados pela base de dados (respeita horário de funcionamento, intervalo, feriados e duração de cada serviço).
- **Proteção contra conflitos**: a própria base de dados recusa dois agendamentos no mesmo horário.
- **Conversas** em tempo real, no estilo do WhatsApp, com botão para a recepção assumir a conversa e pausar a assistente naquele contato.
- **Clientes** com etapas de funil (novo contato → orçamento → cliente).
- **Serviços, horários e feriados** editáveis.
- **Base de conhecimento** da assistente: o texto que a IA usa para responder.

## Tecnologias

- React 19 + Vite
- Supabase (PostgreSQL, autenticação, Row Level Security, tempo real, Edge Functions)
- WhatsApp Cloud API (Meta)
- Cloudflare Pages

## Segurança

- Row Level Security ativo em todas as tabelas: sem login não se lê nem se altera nada.
- O navegador só usa a chave pública do Supabase. Chaves secretas (IA, WhatsApp) ficam apenas nas Edge Functions.

## Como rodar localmente

1. No Supabase, rode `supabase/01_estrutura.sql` e depois `supabase/02_dados_exemplo.sql` no SQL Editor.
2. Copie `.env.example` para `.env` e preencha com a URL e a chave pública do seu projeto.
3. `npm install`
4. `npm run dev`
