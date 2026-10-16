-- İlk kurulumda BİR KEZ çalıştırılır (Supabase → SQL Editor).
-- Önce Supabase → Authentication → Users → "Add user" ile kendi hesabınızı oluşturun,
-- sonra aşağıdaki e-postayı değiştirip çalıştırın.
update public.profiles
set role = 'founder', is_active = true
where id = (select id from auth.users where email = 'SIZIN-EPOSTANIZ@ornek.com');
