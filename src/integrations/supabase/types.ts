export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      app_admins: {
        Row: {
          active: boolean
          created_at: string
          email: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          email: string
        }
        Update: {
          active?: boolean
          created_at?: string
          email?: string
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json | null
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json | null
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json | null
        }
        Relationships: []
      }
      booking_conflicts: {
        Row: {
          booking_id_a: string
          booking_id_b: string
          created_at: string
          id: string
          resolution_notes: string | null
          resolved_at: string | null
          resolved_by: string | null
          room_id: string
          status: string
        }
        Insert: {
          booking_id_a: string
          booking_id_b: string
          created_at?: string
          id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          room_id: string
          status?: string
        }
        Update: {
          booking_id_a?: string
          booking_id_b?: string
          created_at?: string
          id?: string
          resolution_notes?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          room_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "booking_conflicts_booking_id_a_fkey"
            columns: ["booking_id_a"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_conflicts_booking_id_b_fkey"
            columns: ["booking_id_b"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "booking_conflicts_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          avulso_amount: number | null
          avulso_paid_at: string | null
          contract_id: string | null
          created_at: string
          end_at: string
          id: string
          is_maintenance: boolean
          professional_id: string
          reallocated_from: string | null
          reallocated_to: string | null
          room_id: string
          source: string
          start_at: string
          status: string
          updated_at: string
        }
        Insert: {
          avulso_amount?: number | null
          avulso_paid_at?: string | null
          contract_id?: string | null
          created_at?: string
          end_at: string
          id?: string
          is_maintenance?: boolean
          professional_id: string
          reallocated_from?: string | null
          reallocated_to?: string | null
          room_id: string
          source?: string
          start_at: string
          status?: string
          updated_at?: string
        }
        Update: {
          avulso_amount?: number | null
          avulso_paid_at?: string | null
          contract_id?: string | null
          created_at?: string
          end_at?: string
          id?: string
          is_maintenance?: boolean
          professional_id?: string
          reallocated_from?: string | null
          reallocated_to?: string | null
          room_id?: string
          source?: string
          start_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bookings_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_reallocated_from_fkey"
            columns: ["reallocated_from"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_reallocated_to_fkey"
            columns: ["reallocated_to"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      contract_attachments: {
        Row: {
          contract_id: string | null
          created_at: string
          file_name: string
          file_path: string
          id: string
          mime_type: string | null
          professional_id: string
          size_bytes: number | null
          uploaded_by: string | null
        }
        Insert: {
          contract_id?: string | null
          created_at?: string
          file_name: string
          file_path: string
          id?: string
          mime_type?: string | null
          professional_id: string
          size_bytes?: number | null
          uploaded_by?: string | null
        }
        Update: {
          contract_id?: string | null
          created_at?: string
          file_name?: string
          file_path?: string
          id?: string
          mime_type?: string | null
          professional_id?: string
          size_bytes?: number | null
          uploaded_by?: string | null
        }
        Relationships: []
      }
      contract_schedules: {
        Row: {
          contract_id: string
          created_at: string
          end_time: string
          id: string
          room_id: string
          start_time: string
          weekday: number
        }
        Insert: {
          contract_id: string
          created_at?: string
          end_time: string
          id?: string
          room_id: string
          start_time: string
          weekday: number
        }
        Update: {
          contract_id?: string
          created_at?: string
          end_time?: string
          id?: string
          room_id?: string
          start_time?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "contract_schedules_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contract_schedules_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      contracts: {
        Row: {
          cancel_effective_month: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          created_at: string
          due_day: number
          end_date: string | null
          extra_clauses: string | null
          id: string
          locador_name: string | null
          monthly_value: number
          notes: string | null
          professional_id: string
          room_id: string | null
          signature_hash: string | null
          signed_at: string | null
          signed_by_name: string | null
          signed_email: string | null
          signed_gps: string | null
          signed_user_agent: string | null
          start_date: string
          status: string
          template_id: string | null
          termination_fee_amount: number | null
          termination_fee_receivable_id: string | null
          updated_at: string
        }
        Insert: {
          cancel_effective_month?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          due_day?: number
          end_date?: string | null
          extra_clauses?: string | null
          id?: string
          locador_name?: string | null
          monthly_value?: number
          notes?: string | null
          professional_id: string
          room_id?: string | null
          signature_hash?: string | null
          signed_at?: string | null
          signed_by_name?: string | null
          signed_email?: string | null
          signed_gps?: string | null
          signed_user_agent?: string | null
          start_date: string
          status?: string
          template_id?: string | null
          termination_fee_amount?: number | null
          termination_fee_receivable_id?: string | null
          updated_at?: string
        }
        Update: {
          cancel_effective_month?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          created_at?: string
          due_day?: number
          end_date?: string | null
          extra_clauses?: string | null
          id?: string
          locador_name?: string | null
          monthly_value?: number
          notes?: string | null
          professional_id?: string
          room_id?: string | null
          signature_hash?: string | null
          signed_at?: string | null
          signed_by_name?: string | null
          signed_email?: string | null
          signed_gps?: string | null
          signed_user_agent?: string | null
          start_date?: string
          status?: string
          template_id?: string | null
          termination_fee_amount?: number | null
          termination_fee_receivable_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "contracts_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contracts_termination_fee_receivable_id_fkey"
            columns: ["termination_fee_receivable_id"]
            isOneToOne: false
            referencedRelation: "receivables"
            referencedColumns: ["id"]
          },
        ]
      }
      financial_credit_applications: {
        Row: {
          amount: number
          applied_at: string | null
          created_at: string
          created_by: string | null
          id: string
          metadata: Json | null
          module: string
          reason: string | null
          reversed_at: string | null
          source_item_id: string
          source_payment_id: string | null
          status: string
          target_item_id: string | null
        }
        Insert: {
          amount: number
          applied_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json | null
          module: string
          reason?: string | null
          reversed_at?: string | null
          source_item_id: string
          source_payment_id?: string | null
          status?: string
          target_item_id?: string | null
        }
        Update: {
          amount?: number
          applied_at?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json | null
          module?: string
          reason?: string | null
          reversed_at?: string | null
          source_item_id?: string
          source_payment_id?: string | null
          status?: string
          target_item_id?: string | null
        }
        Relationships: []
      }
      notification_queue: {
        Row: {
          channel: string
          created_at: string
          id: string
          message: string
          metadata: Json | null
          recipient: string
          sent_at: string | null
          status: string
          subject: string | null
        }
        Insert: {
          channel: string
          created_at?: string
          id?: string
          message: string
          metadata?: Json | null
          recipient: string
          sent_at?: string | null
          status?: string
          subject?: string | null
        }
        Update: {
          channel?: string
          created_at?: string
          id?: string
          message?: string
          metadata?: Json | null
          recipient?: string
          sent_at?: string | null
          status?: string
          subject?: string | null
        }
        Relationships: []
      }
      payable_payments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          paid_at: string
          payable_id: string
          payment_method: string | null
          reverse_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          status: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          paid_at?: string
          payable_id: string
          payment_method?: string | null
          reverse_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          status?: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          paid_at?: string
          payable_id?: string
          payment_method?: string | null
          reverse_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "payable_payments_payable_id_fkey"
            columns: ["payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
        ]
      }
      payables: {
        Row: {
          amount_due: number
          amount_paid: number
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          category: string | null
          created_at: string
          created_by: string | null
          credit_applied_amount: number
          description: string
          due_date: string
          id: string
          kind: string
          notes: string | null
          parent_payable_id: string | null
          recurrence_day: number | null
          reference_month: string
          remaining_due_date: string | null
          remaining_due_reason: string | null
          remaining_due_updated_at: string | null
          remaining_due_updated_by: string | null
          status: string
          supplier: string | null
          updated_at: string
        }
        Insert: {
          amount_due: number
          amount_paid?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          credit_applied_amount?: number
          description: string
          due_date: string
          id?: string
          kind: string
          notes?: string | null
          parent_payable_id?: string | null
          recurrence_day?: number | null
          reference_month: string
          remaining_due_date?: string | null
          remaining_due_reason?: string | null
          remaining_due_updated_at?: string | null
          remaining_due_updated_by?: string | null
          status?: string
          supplier?: string | null
          updated_at?: string
        }
        Update: {
          amount_due?: number
          amount_paid?: number
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          category?: string | null
          created_at?: string
          created_by?: string | null
          credit_applied_amount?: number
          description?: string
          due_date?: string
          id?: string
          kind?: string
          notes?: string | null
          parent_payable_id?: string | null
          recurrence_day?: number | null
          reference_month?: string
          remaining_due_date?: string | null
          remaining_due_reason?: string | null
          remaining_due_updated_at?: string | null
          remaining_due_updated_by?: string | null
          status?: string
          supplier?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "payables_parent_payable_id_fkey"
            columns: ["parent_payable_id"]
            isOneToOne: false
            referencedRelation: "payables"
            referencedColumns: ["id"]
          },
        ]
      }
      professional_attachments: {
        Row: {
          category: string | null
          created_at: string
          description: string | null
          file_name: string
          file_path: string
          id: string
          mime_type: string | null
          professional_id: string
          size_bytes: number | null
          updated_at: string
          uploaded_by: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string
          description?: string | null
          file_name: string
          file_path: string
          id?: string
          mime_type?: string | null
          professional_id: string
          size_bytes?: number | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string
          description?: string | null
          file_name?: string
          file_path?: string
          id?: string
          mime_type?: string | null
          professional_id?: string
          size_bytes?: number | null
          updated_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "professional_attachments_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
        ]
      }
      professionals: {
        Row: {
          active: boolean
          address: string | null
          color_hex: string | null
          cpf: string | null
          created_at: string
          email: string | null
          full_name: string
          id: string
          notes: string | null
          phone: string | null
          registry: string | null
          specialty: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          address?: string | null
          color_hex?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          notes?: string | null
          phone?: string | null
          registry?: string | null
          specialty?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          address?: string | null
          color_hex?: string | null
          cpf?: string | null
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          phone?: string | null
          registry?: string | null
          specialty?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          professional_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          professional_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          professional_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      receivable_payments: {
        Row: {
          amount: number
          attachment_path: string | null
          created_at: string
          created_by: string | null
          id: string
          notes: string | null
          paid_at: string
          payment_method: string | null
          receivable_id: string
          reverse_reason: string | null
          reversed_at: string | null
          reversed_by: string | null
          status: string
        }
        Insert: {
          amount: number
          attachment_path?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          paid_at: string
          payment_method?: string | null
          receivable_id: string
          reverse_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          status?: string
        }
        Update: {
          amount?: number
          attachment_path?: string | null
          created_at?: string
          created_by?: string | null
          id?: string
          notes?: string | null
          paid_at?: string
          payment_method?: string | null
          receivable_id?: string
          reverse_reason?: string | null
          reversed_at?: string | null
          reversed_by?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "receivable_payments_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "receivables"
            referencedColumns: ["id"]
          },
        ]
      }
      receivable_receipts: {
        Row: {
          amount_due: number
          amount_paid: number
          authentication_code: string | null
          cancel_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          clinic_address: string | null
          clinic_cnpj: string | null
          clinic_name: string | null
          created_at: string
          due_date: string
          id: string
          issued_at: string
          issued_by: string | null
          kind: string
          metadata: Json | null
          paid_at: string
          payment_id: string | null
          payment_method: string | null
          professional_document: string | null
          professional_email: string | null
          professional_id: string
          professional_name: string
          professional_phone: string | null
          receipt_body: string | null
          receipt_footer: string | null
          receipt_number: string
          receipt_path: string | null
          receipt_title: string | null
          receivable_id: string
          reference_month: string
          room_id: string | null
          room_name: string | null
          room_names_snapshot: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_due: number
          amount_paid: number
          authentication_code?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          clinic_address?: string | null
          clinic_cnpj?: string | null
          clinic_name?: string | null
          created_at?: string
          due_date: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          kind: string
          metadata?: Json | null
          paid_at: string
          payment_id?: string | null
          payment_method?: string | null
          professional_document?: string | null
          professional_email?: string | null
          professional_id: string
          professional_name: string
          professional_phone?: string | null
          receipt_body?: string | null
          receipt_footer?: string | null
          receipt_number: string
          receipt_path?: string | null
          receipt_title?: string | null
          receivable_id: string
          reference_month: string
          room_id?: string | null
          room_name?: string | null
          room_names_snapshot?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_due?: number
          amount_paid?: number
          authentication_code?: string | null
          cancel_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          clinic_address?: string | null
          clinic_cnpj?: string | null
          clinic_name?: string | null
          created_at?: string
          due_date?: string
          id?: string
          issued_at?: string
          issued_by?: string | null
          kind?: string
          metadata?: Json | null
          paid_at?: string
          payment_id?: string | null
          payment_method?: string | null
          professional_document?: string | null
          professional_email?: string | null
          professional_id?: string
          professional_name?: string
          professional_phone?: string | null
          receipt_body?: string | null
          receipt_footer?: string | null
          receipt_number?: string
          receipt_path?: string | null
          receipt_title?: string | null
          receivable_id?: string
          reference_month?: string
          room_id?: string | null
          room_name?: string | null
          room_names_snapshot?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "receivable_receipts_payment_id_fkey"
            columns: ["payment_id"]
            isOneToOne: false
            referencedRelation: "receivable_payments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivable_receipts_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "receivables"
            referencedColumns: ["id"]
          },
        ]
      }
      receivable_rooms: {
        Row: {
          created_at: string
          id: string
          receivable_id: string
          room_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          receivable_id: string
          room_id: string
        }
        Update: {
          created_at?: string
          id?: string
          receivable_id?: string
          room_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "receivable_rooms_receivable_id_fkey"
            columns: ["receivable_id"]
            isOneToOne: false
            referencedRelation: "receivables"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivable_rooms_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      receivables: {
        Row: {
          amount_due: number
          amount_paid: number | null
          attachment_path: string | null
          booking_id: string | null
          cancel_reason: string | null
          cancel_type: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          contract_id: string | null
          created_at: string
          credit_applied_amount: number
          due_date: string
          id: string
          kind: string
          notes: string | null
          paid_at: string | null
          payment_method: string | null
          professional_id: string
          reference_month: string
          remaining_due_date: string | null
          remaining_due_reason: string | null
          remaining_due_updated_at: string | null
          remaining_due_updated_by: string | null
          room_id: string | null
          status: string
          updated_at: string
        }
        Insert: {
          amount_due?: number
          amount_paid?: number | null
          attachment_path?: string | null
          booking_id?: string | null
          cancel_reason?: string | null
          cancel_type?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          contract_id?: string | null
          created_at?: string
          credit_applied_amount?: number
          due_date: string
          id?: string
          kind: string
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          professional_id: string
          reference_month: string
          remaining_due_date?: string | null
          remaining_due_reason?: string | null
          remaining_due_updated_at?: string | null
          remaining_due_updated_by?: string | null
          room_id?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          amount_due?: number
          amount_paid?: number | null
          attachment_path?: string | null
          booking_id?: string | null
          cancel_reason?: string | null
          cancel_type?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          contract_id?: string | null
          created_at?: string
          credit_applied_amount?: number
          due_date?: string
          id?: string
          kind?: string
          notes?: string | null
          paid_at?: string | null
          payment_method?: string | null
          professional_id?: string
          reference_month?: string
          remaining_due_date?: string | null
          remaining_due_reason?: string | null
          remaining_due_updated_at?: string | null
          remaining_due_updated_by?: string | null
          room_id?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "receivables_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivables_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivables_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "receivables_room_id_fkey"
            columns: ["room_id"]
            isOneToOne: false
            referencedRelation: "rooms"
            referencedColumns: ["id"]
          },
        ]
      }
      rooms: {
        Row: {
          active: boolean
          capacity: number
          color_hex: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          sort_order: number | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          capacity?: number
          color_hex?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name: string
          sort_order?: number | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          capacity?: number
          color_hex?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          sort_order?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      settings: {
        Row: {
          id: string
          key: string
          updated_at: string
          updated_by: string | null
          value: Json
        }
        Insert: {
          id?: string
          key: string
          updated_at?: string
          updated_by?: string | null
          value: Json
        }
        Update: {
          id?: string
          key?: string
          updated_at?: string
          updated_by?: string | null
          value?: Json
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      cancel_contract: {
        Args: {
          _contract_id: string
          _effective_month: string
          _reason?: string
          _termination_fee?: number
        }
        Returns: Json
      }
      ensure_owner_access: { Args: never; Returns: Json }
      generate_contract_receivables: {
        Args: { _contract_id: string }
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_owner_admin: { Args: never; Returns: boolean }
      mark_overdue_receivables: { Args: never; Returns: number }
      regenerate_contract_receivables: {
        Args: { _contract_id: string }
        Returns: number
      }
    }
    Enums: {
      app_role: "gestor" | "profissional" | "visualizador"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["gestor", "profissional", "visualizador"],
    },
  },
} as const
