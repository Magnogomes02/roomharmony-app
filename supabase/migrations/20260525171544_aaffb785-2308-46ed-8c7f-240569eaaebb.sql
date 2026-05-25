-- Table
CREATE TABLE public.professional_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professional_id uuid NOT NULL REFERENCES public.professionals(id) ON DELETE CASCADE,
  category text,
  description text,
  file_name text NOT NULL,
  file_path text NOT NULL,
  mime_type text,
  size_bytes integer,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_prof_attachments_professional ON public.professional_attachments(professional_id);

ALTER TABLE public.professional_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "prof_attachments gestor all"
  ON public.professional_attachments FOR ALL
  USING (public.has_role(auth.uid(), 'gestor'))
  WITH CHECK (public.has_role(auth.uid(), 'gestor'));

CREATE POLICY "prof_attachments professional read own"
  ON public.professional_attachments FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.professional_id = professional_attachments.professional_id
  ));

CREATE TRIGGER trg_prof_attachments_updated_at
  BEFORE UPDATE ON public.professional_attachments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Storage bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('professional-attachments', 'professional-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: files organized under {professional_id}/...
CREATE POLICY "prof_files gestor all"
  ON storage.objects FOR ALL
  USING (bucket_id = 'professional-attachments' AND public.has_role(auth.uid(), 'gestor'))
  WITH CHECK (bucket_id = 'professional-attachments' AND public.has_role(auth.uid(), 'gestor'));

CREATE POLICY "prof_files professional read own"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'professional-attachments'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.professional_id::text = (storage.foldername(name))[1]
    )
  );
