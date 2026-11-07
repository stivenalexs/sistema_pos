
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "actions": {
                  Row: {
                    "attempts": number,"created_at": string,"error": string | null,"finished_at": string | null,"id": string,"idempotency_key": string,"max_attempts": number,"next_attempt_at": string | null,"payload": NonNullable<Json>,"queue_msg_id": number | null,"result": Json | null,"started_at": string | null,"status": Database["public"]['Enums']["action_status"],"type": string,"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"error"?: string | null,"finished_at"?: string | null,"id"?: string,"idempotency_key": string,"max_attempts"?: number,"next_attempt_at"?: string | null,"payload"?: NonNullable<Json>,"queue_msg_id"?: number | null,"result"?: Json | null,"started_at"?: string | null,"status"?: Database["public"]['Enums']["action_status"],"type": string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"error"?: string | null,"finished_at"?: string | null,"id"?: string,"idempotency_key"?: string,"max_attempts"?: number,"next_attempt_at"?: string | null,"payload"?: NonNullable<Json>,"queue_msg_id"?: number | null,"result"?: Json | null,"started_at"?: string | null,"status"?: Database["public"]['Enums']["action_status"],"type"?: string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"customers": {
                  Row: {
                    "business_name": string | null,"created_at": string,"customer_type": Database["public"]['Enums']["customer_type"],"document_number": string | null,"document_type": Database["public"]['Enums']["document_type"] | null,"full_name": string,"id": string,"phone": string | null,"price_list_id": string | null,"updated_at": string,"wholesale_status": Database["public"]['Enums']["wholesale_status"] | null
                  }
                  ComputedFields: never
                  Insert: {
                    "business_name"?: string | null,"created_at"?: string,"customer_type": Database["public"]['Enums']["customer_type"],"document_number"?: string | null,"document_type"?: Database["public"]['Enums']["document_type"] | null,"full_name": string,"id": string,"phone"?: string | null,"price_list_id"?: string | null,"updated_at"?: string,"wholesale_status"?: Database["public"]['Enums']["wholesale_status"] | null
                  }
                  Update: {
                    "business_name"?: string | null,"created_at"?: string,"customer_type"?: Database["public"]['Enums']["customer_type"],"document_number"?: string | null,"document_type"?: Database["public"]['Enums']["document_type"] | null,"full_name"?: string,"id"?: string,"phone"?: string | null,"price_list_id"?: string | null,"updated_at"?: string,"wholesale_status"?: Database["public"]['Enums']["wholesale_status"] | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "customers_price_list_id_fkey"
      columns: ["price_list_id"]
isOneToOne: false
      referencedRelation: "price_lists"
      referencedColumns: ["id"]
    }
                  ]
                },"legal_acceptances": {
                  Row: {
                    "accepted_at": string,"declared_birth_date": string | null,"document": Database["public"]['Enums']["legal_document"],"id": string,"user_id": string | null,"version": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string,"declared_birth_date"?: string | null,"document": Database["public"]['Enums']["legal_document"],"id"?: string,"user_id"?: string | null,"version": string
                  }
                  Update: {
                    "accepted_at"?: string,"declared_birth_date"?: string | null,"document"?: Database["public"]['Enums']["legal_document"],"id"?: string,"user_id"?: string | null,"version"?: string
                  }
                  Relationships: [
                    
                  ]
                },"price_lists": {
                  Row: {
                    "created_at": string,"customer_type": Database["public"]['Enums']["customer_type"],"id": string,"is_default": boolean,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"customer_type": Database["public"]['Enums']["customer_type"],"id"?: string,"is_default"?: boolean,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"customer_type"?: Database["public"]['Enums']["customer_type"],"id"?: string,"is_default"?: boolean,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"product_prices": {
                  Row: {
                    "created_at": string,"id": string,"price_cop": number,"price_list_id": string,"product_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"price_cop": number,"price_list_id": string,"product_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"price_cop"?: number,"price_list_id"?: string,"product_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_prices_price_list_id_fkey"
      columns: ["price_list_id"]
isOneToOne: false
      referencedRelation: "price_lists"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "product_prices_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"products": {
                  Row: {
                    "allow_retail_by_unit": boolean,"brand": string | null,"created_at": string,"description": string | null,"id": string,"is_active": boolean,"name": string,"origin": Database["public"]['Enums']["product_origin"],"retail_min_units": number,"sku": string,"units_per_box": number,"updated_at": string,"volume_ml": number | null,"wholesale_min_boxes": number
                  }
                  ComputedFields: never
                  Insert: {
                    "allow_retail_by_unit"?: boolean,"brand"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"name": string,"origin": Database["public"]['Enums']["product_origin"],"retail_min_units"?: number,"sku": string,"units_per_box": number,"updated_at"?: string,"volume_ml"?: number | null,"wholesale_min_boxes"?: number
                  }
                  Update: {
                    "allow_retail_by_unit"?: boolean,"brand"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"name"?: string,"origin"?: Database["public"]['Enums']["product_origin"],"retail_min_units"?: number,"sku"?: string,"units_per_box"?: number,"updated_at"?: string,"volume_ml"?: number | null,"wholesale_min_boxes"?: number
                  }
                  Relationships: [
                    
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "claim_actions":
{ Args: { "p_batch"?: number,"p_visibility_seconds"?: number }; Returns: {
              "action_id": string,"attempt": number,"max_attempts": number,"payload": Json,"type": string,"user_id": string
            }[]
                           },
"complete_action":
{ Args: { "p_action_id": string,"p_result"?: Json }; Returns: undefined
                           },
"enqueue_action":
{ Args: { "p_idempotency_key": string,"p_max_attempts"?: number,"p_payload"?: Json,"p_type": string,"p_user_id": string }; Returns: {
              "created": boolean,"tracking_id": string
            }[]
                           },
"fail_action":
{ Args: { "p_action_id": string,"p_error": string,"p_permanent"?: boolean }; Returns: Database["public"]['Enums']["action_status"]
                           }
          }
          Enums: {
            "action_status": "queued"|"processing"|"succeeded"|"failed","customer_type": "retail"|"wholesale","document_type": "cc"|"ce"|"nit"|"passport","legal_document": "age_gate"|"terms"|"privacy","product_origin": "national"|"imported","staff_role": "admin"|"cashier"|"courier"|"warehouse","wholesale_status": "pending"|"approved"|"rejected"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "action_status": ["queued", "processing", "succeeded", "failed"],"customer_type": ["retail", "wholesale"],"document_type": ["cc", "ce", "nit", "passport"],"legal_document": ["age_gate", "terms", "privacy"],"product_origin": ["national", "imported"],"staff_role": ["admin", "cashier", "courier", "warehouse"],"wholesale_status": ["pending", "approved", "rejected"]
          }
        }
} as const
