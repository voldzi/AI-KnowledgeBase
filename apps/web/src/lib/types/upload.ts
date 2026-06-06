export interface UploadPreflightDecision {
  upload_session_id: string;
  upload_url: string;
  upload_method: "PUT";
  source_file_uri: string;
  expires_at: string;
  required_headers: Record<string, string>;
  bucket: string;
  object_key: string;
  file: {
    filename: string;
    mime_type: string;
    size_bytes: number;
    sha256: string;
  };
  limits: {
    max_file_bytes: number;
    accepted_mime_types: string[];
  };
}

export interface UploadContentResponse {
  uploaded: boolean;
  upload_session_id: string;
  source_file_uri: string;
  file: {
    filename: string;
    mime_type: string;
    size_bytes: number;
    sha256: string;
  };
}
