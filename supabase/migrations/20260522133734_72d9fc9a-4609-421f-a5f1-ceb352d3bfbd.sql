CREATE POLICY "clinic-assets public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'clinic-assets');