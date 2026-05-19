
-- Add locador_name to contracts
ALTER TABLE public.contracts
  ADD COLUMN IF NOT EXISTS locador_name text;

-- Attachments table
CREATE TABLE IF NOT EXISTS public.contract_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL,
  contract_id uuid,
  file_name text NOT NULL,
  file_path text NOT NULL,
  mime_type text,
  size_bytes integer,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.contract_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "attachments read auth" ON public.contract_attachments
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "attachments gestor write" ON public.contract_attachments
  FOR ALL USING (has_role(auth.uid(), 'gestor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'gestor'::app_role));

-- Storage bucket
INSERT INTO storage.buckets (id, name, public)
VALUES ('contract-attachments', 'contract-attachments', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "contract attachments read auth"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'contract-attachments');

CREATE POLICY "contract attachments gestor insert"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'contract-attachments' AND has_role(auth.uid(), 'gestor'::app_role));

CREATE POLICY "contract attachments gestor update"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'contract-attachments' AND has_role(auth.uid(), 'gestor'::app_role));

CREATE POLICY "contract attachments gestor delete"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'contract-attachments' AND has_role(auth.uid(), 'gestor'::app_role));
