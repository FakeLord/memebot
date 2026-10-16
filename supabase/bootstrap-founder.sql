-- İlk kurulumda BİR KEZ çalıştırılır (Supabase → SQL Editor).
-- Önce Supabase → Authentication → Users → "Add user" ile kendi hesabınızı oluşturun,
-- sonra aşağıdaki e-postayı değiştirip çalıştırın.
--
-- Hesap migration'dan ÖNCE oluşturulduysa profil satırı yoktur; bu sorgu o durumda
-- satırı oluşturur, varsa founder + aktif yapar.
insert into public.profiles (id, username, role, is_active)
select id, split_part(email, '@', 1), 'founder', true
from auth.users
where lower(email) = lower('SIZIN-EPOSTANIZ@ornek.com')
on conflict (id) do update set role = 'founder', is_active = true;

-- Kontrol: kendi satırınız role = founder, is_active = true görünmeli
select u.email, p.username, p.role, p.is_active
from auth.users u
left join public.profiles p on p.id = u.id;
