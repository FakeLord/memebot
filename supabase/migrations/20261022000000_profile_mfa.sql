-- Profil özelleştirme (görünen ad, avatar, durum notu) ve iki adımlı doğrulama (TOTP) zorunluluğu.

-- Tekrar çalıştırılabilir (idempotent). Check kısıtları sütunla birlikte yalnız ilk eklemede oluşur.
-- ---------------------------------------------------------------- profil alanları
alter table public.profiles
  add column if not exists display_name text check (display_name is null or char_length(display_name) between 1 and 30),
  add column if not exists avatar_emoji text check (avatar_emoji is null or char_length(avatar_emoji) between 1 and 8),
  add column if not exists avatar_color text check (avatar_color is null or avatar_color ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists status_text  text check (status_text is null or char_length(status_text) <= 80);

-- Kullanıcı yalnız KENDİ görünüm alanlarını değiştirebilir (rol/aktiflik alanlarına dokunamaz).
create or replace function public.update_my_profile(p_display_name text, p_avatar_emoji text, p_avatar_color text, p_status_text text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or public.my_role() is null then
    raise exception 'yetkisiz';
  end if;
  update public.profiles set
    display_name = nullif(btrim(p_display_name), ''),
    avatar_emoji = nullif(btrim(p_avatar_emoji), ''),
    avatar_color = nullif(p_avatar_color, ''),
    status_text  = nullif(btrim(p_status_text), '')
  where id = auth.uid();
end $$;
revoke all on function public.update_my_profile(text, text, text, text) from public;
grant execute on function public.update_my_profile(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------- 2FA zorunluluğu
-- Hesapta doğrulanmış bir TOTP faktörü varsa, yalnızca ikinci adımı geçmiş (aal2) oturum yetki alır.
-- Bütün politikalar my_role() üzerinden geçtiği için parolayı bilen biri kodsuz veriye erişemez.
create or replace function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select p.role from public.profiles p
  where p.id = auth.uid() and p.is_active
    and (
      coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified')
    )
$$;
