export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      approval: {
        Row: {
          approver_decision: string
          approver_id: string | null
          created_at: string
          id: string
          md_decision: string
          md_id: string | null
          md_summary: string | null
          rm_sheet_id: string
          sent_to_md_at: string | null
        }
        Insert: {
          approver_decision?: string
          approver_id?: string | null
          created_at?: string
          id?: string
          md_decision?: string
          md_id?: string | null
          md_summary?: string | null
          rm_sheet_id: string
          sent_to_md_at?: string | null
        }
        Update: {
          approver_decision?: string
          approver_id?: string | null
          created_at?: string
          id?: string
          md_decision?: string
          md_id?: string | null
          md_summary?: string | null
          rm_sheet_id?: string
          sent_to_md_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "approval_rm_sheet_id_fkey"
            columns: ["rm_sheet_id"]
            isOneToOne: false
            referencedRelation: "rm_sheet"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: Json | null
          entity: string
          entity_id: string | null
          id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          entity: string
          entity_id?: string | null
          id?: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: Json | null
          entity?: string
          entity_id?: string | null
          id?: string
        }
        Relationships: []
      }
      escalation: {
        Row: {
          assigned_buyer: string | null
          created_at: string
          escalate_after: string
          escalated_to_md_at: string | null
          id: string
          item_code: string | null
          location: string | null
          lot: string | null
          po_id: string | null
          raised_by: string | null
          reason: string | null
          resolved_at: string | null
          resolved_by: string | null
          rm_sheet_id: string
          status: string
        }
        Insert: {
          assigned_buyer?: string | null
          created_at?: string
          escalate_after: string
          escalated_to_md_at?: string | null
          id?: string
          item_code?: string | null
          location?: string | null
          lot?: string | null
          po_id?: string | null
          raised_by?: string | null
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          rm_sheet_id: string
          status?: string
        }
        Update: {
          assigned_buyer?: string | null
          created_at?: string
          escalate_after?: string
          escalated_to_md_at?: string | null
          id?: string
          item_code?: string | null
          location?: string | null
          lot?: string | null
          po_id?: string | null
          raised_by?: string | null
          reason?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          rm_sheet_id?: string
          status?: string
        }
        Relationships: []
      }
      grn: {
        Row: {
          department: string | null
          doc_date: string | null
          doc_no: string | null
          grc_date: string | null
          grc_no: string
          id: string
          imported_at: string
          imported_by: string | null
          item_code: string | null
          item_name: string | null
          landed_cost: number | null
          lot: string | null
          po_date: string | null
          po_number: string | null
          qty: number
          raw: Json | null
          remarks: string | null
          stock_point: string | null
          supplier: string | null
        }
        Insert: {
          department?: string | null
          doc_date?: string | null
          doc_no?: string | null
          grc_date?: string | null
          grc_no: string
          id?: string
          imported_at?: string
          imported_by?: string | null
          item_code?: string | null
          item_name?: string | null
          landed_cost?: number | null
          lot?: string | null
          po_date?: string | null
          po_number?: string | null
          qty?: number
          raw?: Json | null
          remarks?: string | null
          stock_point?: string | null
          supplier?: string | null
        }
        Update: {
          department?: string | null
          doc_date?: string | null
          doc_no?: string | null
          grc_date?: string | null
          grc_no?: string
          id?: string
          imported_at?: string
          imported_by?: string | null
          item_code?: string | null
          item_name?: string | null
          landed_cost?: number | null
          lot?: string | null
          po_date?: string | null
          po_number?: string | null
          qty?: number
          raw?: Json | null
          remarks?: string | null
          stock_point?: string | null
          supplier?: string | null
        }
        Relationships: []
      }
      grn_mail: {
        Row: {
          detail: string | null
          filename: string | null
          id: string
          lines: number
          message_id: string
          processed_at: string
          processed_by: string | null
          sender: string | null
          status: string
          subject: string | null
        }
        Insert: {
          detail?: string | null
          filename?: string | null
          id?: string
          lines?: number
          message_id: string
          processed_at?: string
          processed_by?: string | null
          sender?: string | null
          status?: string
          subject?: string | null
        }
        Update: {
          detail?: string | null
          filename?: string | null
          id?: string
          lines?: number
          message_id?: string
          processed_at?: string
          processed_by?: string | null
          sender?: string | null
          status?: string
          subject?: string | null
        }
        Relationships: []
      }
      item_master: {
        Row: {
          article_name: string | null
          base_unit: string
          category: string
          created_at: string
          hsn_code: string | null
          item_code: string
          material_type: string | null
          moq: number
          name: string
        }
        Insert: {
          article_name?: string | null
          base_unit: string
          category: string
          created_at?: string
          hsn_code?: string | null
          item_code: string
          material_type?: string | null
          moq?: number
          name: string
        }
        Update: {
          article_name?: string | null
          base_unit?: string
          category?: string
          created_at?: string
          hsn_code?: string | null
          item_code?: string
          material_type?: string | null
          moq?: number
          name?: string
        }
        Relationships: []
      }
      po: {
        Row: {
          approval_note: string | null
          approval_status: string
          approved_at: string | null
          approved_by: string | null
          created_at: string
          created_by: string | null
          doc_path: string | null
          etd: string | null
          id: string
          po_number: string | null
          rm_sheet_id: string
          site: string | null
          status: string
          uploaded_by: string | null
        }
        Insert: {
          approval_note?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          doc_path?: string | null
          etd?: string | null
          id?: string
          po_number?: string | null
          rm_sheet_id: string
          site?: string | null
          status?: string
          uploaded_by?: string | null
        }
        Update: {
          approval_note?: string | null
          approval_status?: string
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          doc_path?: string | null
          etd?: string | null
          id?: string
          po_number?: string | null
          rm_sheet_id?: string
          site?: string | null
          status?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "po_rm_sheet_id_fkey"
            columns: ["rm_sheet_id"]
            isOneToOne: false
            referencedRelation: "rm_sheet"
            referencedColumns: ["id"]
          },
        ]
      }
      po_line: {
        Row: {
          created_at: string
          etd: string | null
          id: string
          item_code: string | null
          location: string | null
          lot: string | null
          moq: number
          ordered_qty: number
          po_id: string
          rate: number | null
          raw_label: string | null
          raw_unit: string | null
          remark: string | null
          site: string | null
          supplier: string | null
        }
        Insert: {
          created_at?: string
          etd?: string | null
          id?: string
          item_code?: string | null
          location?: string | null
          lot?: string | null
          moq?: number
          ordered_qty: number
          po_id: string
          rate?: number | null
          raw_label?: string | null
          raw_unit?: string | null
          remark?: string | null
          site?: string | null
          supplier?: string | null
        }
        Update: {
          created_at?: string
          etd?: string | null
          id?: string
          item_code?: string | null
          location?: string | null
          lot?: string | null
          moq?: number
          ordered_qty?: number
          po_id?: string
          rate?: number | null
          raw_label?: string | null
          raw_unit?: string | null
          remark?: string | null
          site?: string | null
          supplier?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "po_line_item_code_fkey"
            columns: ["item_code"]
            isOneToOne: false
            referencedRelation: "item_master"
            referencedColumns: ["item_code"]
          },
          {
            foreignKeyName: "po_line_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "po"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
        }
        Relationships: []
      }
      rm_requirement: {
        Row: {
          assigned_buyer: string | null
          color: string | null
          created_at: string
          department: string | null
          id: string
          item_code: string | null
          location: string | null
          lot: string | null
          match_confidence: number | null
          needs_review: boolean
          raw_code: string | null
          raw_label: string | null
          raw_row: Json | null
          raw_unit: string | null
          required_qty: number
          rm_sheet_id: string
        }
        Insert: {
          assigned_buyer?: string | null
          color?: string | null
          created_at?: string
          department?: string | null
          id?: string
          item_code?: string | null
          location?: string | null
          lot?: string | null
          match_confidence?: number | null
          needs_review?: boolean
          raw_code?: string | null
          raw_label?: string | null
          raw_row?: Json | null
          raw_unit?: string | null
          required_qty: number
          rm_sheet_id: string
        }
        Update: {
          assigned_buyer?: string | null
          color?: string | null
          created_at?: string
          department?: string | null
          id?: string
          item_code?: string | null
          location?: string | null
          lot?: string | null
          match_confidence?: number | null
          needs_review?: boolean
          raw_code?: string | null
          raw_label?: string | null
          raw_row?: Json | null
          raw_unit?: string | null
          required_qty?: number
          rm_sheet_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rm_requirement_item_code_fkey"
            columns: ["item_code"]
            isOneToOne: false
            referencedRelation: "item_master"
            referencedColumns: ["item_code"]
          },
          {
            foreignKeyName: "rm_requirement_rm_sheet_id_fkey"
            columns: ["rm_sheet_id"]
            isOneToOne: false
            referencedRelation: "rm_sheet"
            referencedColumns: ["id"]
          },
        ]
      }
      rm_sheet: {
        Row: {
          content_hash: string | null
          created_at: string
          file_path: string | null
          id: string
          status: string
          style_ref: string | null
          uploaded_by: string | null
        }
        Insert: {
          content_hash?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          status?: string
          style_ref?: string | null
          uploaded_by?: string | null
        }
        Update: {
          content_hash?: string | null
          created_at?: string
          file_path?: string | null
          id?: string
          status?: string
          style_ref?: string | null
          uploaded_by?: string | null
        }
        Relationships: []
      }
      uom_conversion: {
        Row: {
          factor_to_base: number
          from_unit: string
          item_code: string
        }
        Insert: {
          factor_to_base: number
          from_unit: string
          item_code: string
        }
        Update: {
          factor_to_base?: number
          from_unit?: string
          item_code?: string
        }
        Relationships: [
          {
            foreignKeyName: "uom_conversion_item_code_fkey"
            columns: ["item_code"]
            isOneToOne: false
            referencedRelation: "item_master"
            referencedColumns: ["item_code"]
          },
        ]
      }
    }
    Views: {
      po_delivery: {
        Row: {
          distinct_etds: number | null
          distinct_sites: number | null
          etd: string | null
          po_id: string | null
          site: string | null
        }
        Relationships: []
      }
      reconciliation: {
        Row: {
          base_unit: string | null
          category: string | null
          drafted: number | null
          expected_max: number | null
          item_code: string | null
          location: string | null
          lot: string | null
          moq: number | null
          moq_forced: boolean | null
          name: string | null
          ordered: number | null
          required: number | null
          rm_sheet_id: string | null
          status: string | null
          tol: number | null
          variance: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      add_working_hours: {
        Args: { p_start: string; p_hours: number }
        Returns: string
      }
      assign_buyers: {
        Args: { p_assignments: Json; p_sheet_id: string }
        Returns: Json
      }
      assigned_buyer_counts: {
        Args: { p_sheet_id: string }
        Returns: {
          buyer_id: string
          lines: number
        }[]
      }
      buyer_on_sheet: { Args: { sheet: string }; Returns: boolean }
      can_see_po: { Args: { p: string }; Returns: boolean }
      has_role: {
        Args: { roles: Database["public"]["Enums"]["app_role"][] }
        Returns: boolean
      }
      is_staff: { Args: never; Returns: boolean }
      my_role: { Args: never; Returns: Database["public"]["Enums"]["app_role"] }
    }
    Enums: {
      app_role:
        | "uploader"
        | "purchase_head"
        | "buyer"
        | "po_team"
        | "approver"
        | "md"
        | "admin"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

export type AppRole = Database["public"]["Enums"]["app_role"]
