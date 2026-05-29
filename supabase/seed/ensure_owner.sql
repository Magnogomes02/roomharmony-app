-- Garante que o e-mail principal do Gestor/Owner esteja sempre cadastrado.
-- Pode ser rodado várias vezes sem efeito colateral.
INSERT INTO public.app_admins (email, active)
VALUES ('gestor@versaosaude.com', true)
ON CONFLICT (email) DO UPDATE SET active = true;
