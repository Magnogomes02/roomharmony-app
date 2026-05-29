INSERT INTO public.app_admins (email, active)
VALUES ('magno.gomes02@gmail.com', true)
ON CONFLICT (email) DO UPDATE SET active = true;