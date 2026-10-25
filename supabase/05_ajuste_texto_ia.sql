-- =====================================================================
--  FICHEIRO 5: ajusta o texto da clínica para a IA agendar sozinha
--  (troca a regra antiga que mandava passar pedidos para a recepção)
--  Cola no SQL Editor do Supabase e carrega em "Run".
-- =====================================================================
update public.clinic_settings
   set info_ia = replace(
         info_ia,
         'Se a cliente pedir algo que não está aqui, reclamar, ou pedir para falar com uma pessoa, passar para a recepção.',
         'Agendar diretamente nos horários livres. Reclamações, dúvidas de saúde ou pedido para falar com uma pessoa: passar para a recepção.'
       ),
       updated_at = now()
 where id = 1;
