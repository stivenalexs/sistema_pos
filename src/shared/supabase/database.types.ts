
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
                },"app_settings": {
                  Row: {
                    "key": string,"updated_at": string,"value": NonNullable<Json>
                  }
                  ComputedFields: never
                  Insert: {
                    "key": string,"updated_at"?: string,"value": NonNullable<Json>
                  }
                  Update: {
                    "key"?: string,"updated_at"?: string,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"cart_items": {
                  Row: {
                    "cart_id": string,"created_at": string,"id": string,"product_id": string,"quantity": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cart_id": string,"created_at"?: string,"id"?: string,"product_id": string,"quantity": number,"updated_at"?: string
                  }
                  Update: {
                    "cart_id"?: string,"created_at"?: string,"id"?: string,"product_id"?: string,"quantity"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "cart_items_cart_id_fkey"
      columns: ["cart_id"]
isOneToOne: false
      referencedRelation: "carts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "cart_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"carts": {
                  Row: {
                    "created_at": string,"customer_id": string,"id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"customer_id": string,"id"?: string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"customer_id"?: string,"id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "carts_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: true
      referencedRelation: "customers"
      referencedColumns: ["id"]
    }
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
                },"inventory_movements": {
                  Row: {
                    "created_at": string,"created_by": string | null,"id": string,"idempotency_key": string | null,"movement_type": Database["public"]['Enums']["inventory_movement_type"],"product_id": string,"reason": string | null,"reference": string | null,"reservation_id": string | null,"units": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"idempotency_key"?: string | null,"movement_type": Database["public"]['Enums']["inventory_movement_type"],"product_id": string,"reason"?: string | null,"reference"?: string | null,"reservation_id"?: string | null,"units": number
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"id"?: string,"idempotency_key"?: string | null,"movement_type"?: Database["public"]['Enums']["inventory_movement_type"],"product_id"?: string,"reason"?: string | null,"reference"?: string | null,"reservation_id"?: string | null,"units"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "inventory_movements_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "inventory_movements_reservation_id_fkey"
      columns: ["reservation_id"]
isOneToOne: false
      referencedRelation: "stock_reservations"
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
                },"order_events": {
                  Row: {
                    "actor_id": string | null,"created_at": string,"from_status": Database["public"]['Enums']["order_status"] | null,"id": string,"order_id": string,"reason": string | null,"to_status": Database["public"]['Enums']["order_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"created_at"?: string,"from_status"?: Database["public"]['Enums']["order_status"] | null,"id"?: string,"order_id": string,"reason"?: string | null,"to_status": Database["public"]['Enums']["order_status"]
                  }
                  Update: {
                    "actor_id"?: string | null,"created_at"?: string,"from_status"?: Database["public"]['Enums']["order_status"] | null,"id"?: string,"order_id"?: string,"reason"?: string | null,"to_status"?: Database["public"]['Enums']["order_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_events_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"order_items": {
                  Row: {
                    "base_units": number,"created_at": string,"id": string,"line_total_cop": number,"order_id": string,"product_id": string,"product_name": string,"quantity": number,"sale_unit": string,"sku": string,"unit_price_cop": number,"units_per_box": number
                  }
                  ComputedFields: never
                  Insert: {
                    "base_units": number,"created_at"?: string,"id"?: string,"line_total_cop": number,"order_id": string,"product_id": string,"product_name": string,"quantity": number,"sale_unit": string,"sku": string,"unit_price_cop": number,"units_per_box": number
                  }
                  Update: {
                    "base_units"?: number,"created_at"?: string,"id"?: string,"line_total_cop"?: number,"order_id"?: string,"product_id"?: string,"product_name"?: string,"quantity"?: number,"sale_unit"?: string,"sku"?: string,"unit_price_cop"?: number,"units_per_box"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "order_items_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "order_items_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"orders": {
                  Row: {
                    "cancel_after": string | null,"cancel_reason": string | null,"cancelled_at": string | null,"channel": Database["public"]['Enums']["order_channel"],"created_at": string,"customer_id": string | null,"delivery_fee_cop": number,"fulfillment": Database["public"]['Enums']["fulfillment_method"],"id": string,"idempotency_key": string,"needs_refund": boolean,"paid_at": string | null,"payment_deadline": string | null,"refund_reason": string | null,"sale_unit": string,"status": Database["public"]['Enums']["order_status"],"subtotal_cop": number,"total_base_units": number,"total_boxes": number,"total_cop": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "cancel_after"?: string | null,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"channel": Database["public"]['Enums']["order_channel"],"created_at"?: string,"customer_id"?: string | null,"delivery_fee_cop"?: number,"fulfillment": Database["public"]['Enums']["fulfillment_method"],"id"?: string,"idempotency_key": string,"needs_refund"?: boolean,"paid_at"?: string | null,"payment_deadline"?: string | null,"refund_reason"?: string | null,"sale_unit": string,"status"?: Database["public"]['Enums']["order_status"],"subtotal_cop": number,"total_base_units": number,"total_boxes"?: number,"total_cop": number,"updated_at"?: string
                  }
                  Update: {
                    "cancel_after"?: string | null,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"channel"?: Database["public"]['Enums']["order_channel"],"created_at"?: string,"customer_id"?: string | null,"delivery_fee_cop"?: number,"fulfillment"?: Database["public"]['Enums']["fulfillment_method"],"id"?: string,"idempotency_key"?: string,"needs_refund"?: boolean,"paid_at"?: string | null,"payment_deadline"?: string | null,"refund_reason"?: string | null,"sale_unit"?: string,"status"?: Database["public"]['Enums']["order_status"],"subtotal_cop"?: number,"total_base_units"?: number,"total_boxes"?: number,"total_cop"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "orders_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_attempts": {
                  Row: {
                    "amount_in_cents": number,"attempt_number": number,"created_at": string,"currency": string,"expires_at": string,"finalized_at": string | null,"id": string,"idempotency_key": string,"order_id": string,"payment_method_type": string | null,"reference": string,"status": Database["public"]['Enums']["payment_attempt_status"],"status_message": string | null,"transaction_id_hint": string | null,"updated_at": string,"wompi_transaction_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_in_cents": number,"attempt_number": number,"created_at"?: string,"currency"?: string,"expires_at": string,"finalized_at"?: string | null,"id"?: string,"idempotency_key": string,"order_id": string,"payment_method_type"?: string | null,"reference": string,"status"?: Database["public"]['Enums']["payment_attempt_status"],"status_message"?: string | null,"transaction_id_hint"?: string | null,"updated_at"?: string,"wompi_transaction_id"?: string | null
                  }
                  Update: {
                    "amount_in_cents"?: number,"attempt_number"?: number,"created_at"?: string,"currency"?: string,"expires_at"?: string,"finalized_at"?: string | null,"id"?: string,"idempotency_key"?: string,"order_id"?: string,"payment_method_type"?: string | null,"reference"?: string,"status"?: Database["public"]['Enums']["payment_attempt_status"],"status_message"?: string | null,"transaction_id_hint"?: string | null,"updated_at"?: string,"wompi_transaction_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_attempts_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"payment_events": {
                  Row: {
                    "amount_in_cents": number | null,"checksum": string,"currency": string | null,"event_type": string,"id": string,"outcome": string | null,"payload": NonNullable<Json>,"processed_at": string | null,"received_at": string,"reference": string | null,"source": string,"status": string | null,"transaction_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount_in_cents"?: number | null,"checksum": string,"currency"?: string | null,"event_type": string,"id"?: string,"outcome"?: string | null,"payload": NonNullable<Json>,"processed_at"?: string | null,"received_at"?: string,"reference"?: string | null,"source": string,"status"?: string | null,"transaction_id"?: string | null
                  }
                  Update: {
                    "amount_in_cents"?: number | null,"checksum"?: string,"currency"?: string | null,"event_type"?: string,"id"?: string,"outcome"?: string | null,"payload"?: NonNullable<Json>,"processed_at"?: string | null,"received_at"?: string,"reference"?: string | null,"source"?: string,"status"?: string | null,"transaction_id"?: string | null
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
                },"product_stock": {
                  Row: {
                    "on_hand": number,"product_id": string,"reserved": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "on_hand"?: number,"product_id": string,"reserved"?: number,"updated_at"?: string
                  }
                  Update: {
                    "on_hand"?: number,"product_id"?: string,"reserved"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "product_stock_product_id_fkey"
      columns: ["product_id"]
isOneToOne: true
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"products": {
                  Row: {
                    "allow_retail_by_unit": boolean,"brand": string | null,"created_at": string,"description": string | null,"id": string,"is_active": boolean,"low_stock_threshold": number,"name": string,"origin": Database["public"]['Enums']["product_origin"],"retail_min_units": number,"sku": string,"units_per_box": number,"updated_at": string,"volume_ml": number | null,"web_safety_stock": number,"wholesale_min_boxes": number
                  }
                  ComputedFields: never
                  Insert: {
                    "allow_retail_by_unit"?: boolean,"brand"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"low_stock_threshold"?: number,"name": string,"origin": Database["public"]['Enums']["product_origin"],"retail_min_units"?: number,"sku": string,"units_per_box": number,"updated_at"?: string,"volume_ml"?: number | null,"web_safety_stock"?: number,"wholesale_min_boxes"?: number
                  }
                  Update: {
                    "allow_retail_by_unit"?: boolean,"brand"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"is_active"?: boolean,"low_stock_threshold"?: number,"name"?: string,"origin"?: Database["public"]['Enums']["product_origin"],"retail_min_units"?: number,"sku"?: string,"units_per_box"?: number,"updated_at"?: string,"volume_ml"?: number | null,"web_safety_stock"?: number,"wholesale_min_boxes"?: number
                  }
                  Relationships: [
                    
                  ]
                },"stock_reservations": {
                  Row: {
                    "created_at": string,"created_by": string | null,"expires_at": string,"id": string,"product_id": string,"reference": string,"status": Database["public"]['Enums']["reservation_status"],"units": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"created_by"?: string | null,"expires_at": string,"id"?: string,"product_id": string,"reference": string,"status"?: Database["public"]['Enums']["reservation_status"],"units": number,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"created_by"?: string | null,"expires_at"?: string,"id"?: string,"product_id"?: string,"reference"?: string,"status"?: Database["public"]['Enums']["reservation_status"],"units"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "stock_reservations_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "apply_payment_event":
{ Args: { "p_event_id": string }; Returns: string
                           },
"cancel_abandoned_orders":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"cancel_order":
{ Args: { "p_order_id": string }; Returns: boolean
                           },
"claim_actions":
{ Args: { "p_batch"?: number,"p_visibility_seconds"?: number }; Returns: {
              "action_id": string,"attempt": number,"max_attempts": number,"payload": Json,"type": string,"user_id": string
            }[]
                           },
"complete_action":
{ Args: { "p_action_id": string,"p_result"?: Json }; Returns: undefined
                           },
"consume_reservation":
{ Args: { "p_idempotency_key": string,"p_items": Json,"p_reference": string }; Returns: number
                           },
"enqueue_action":
{ Args: { "p_idempotency_key": string,"p_max_attempts"?: number,"p_payload"?: Json,"p_type": string,"p_user_id": string }; Returns: {
              "created": boolean,"tracking_id": string
            }[]
                           },
"fail_action":
{ Args: { "p_action_id": string,"p_error": string,"p_permanent"?: boolean }; Returns: Database["public"]['Enums']["action_status"]
                           },
"get_cart_items":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_catalog":
{ Args: Record<PropertyKey, never>; Returns: {
              "brand": string,"description": string,"min_quantity": number,"name": string,"origin": Database["public"]['Enums']["product_origin"],"price_cop": number,"price_list_id": string,"product_id": string,"sale_unit": string,"sku": string,"units_per_box": number,"volume_ml": number
            }[]
                           },
"get_web_availability":
{ Args: Record<PropertyKey, never>; Returns: {
              "available_sale_units": number,"available_units": number,"product_id": string
            }[]
                           },
"low_stock_products":
{ Args: Record<PropertyKey, never>; Returns: {
              "name": string,"on_hand": number,"product_id": string,"reserved": number,"sku": string,"threshold": number
            }[]
                           },
"payments_to_reconcile":
{ Args: { "p_limit"?: number,"p_min_age_minutes"?: number }; Returns: {
              "attempt_id": string,"transaction_id": string
            }[]
                           },
"place_order":
{ Args: { "p_fulfillment"?: Database["public"]['Enums']["fulfillment_method"],"p_idempotency_key": string }; Returns: Json
                           },
"quote_items":
{ Args: { "p_items": Json }; Returns: Json
                           },
"reconcile_stock":
{ Args: Record<PropertyKey, never>; Returns: {
              "ledger_on_hand": number,"ledger_reserved": number,"on_hand": number,"product_id": string,"reserved": number
            }[]
                           },
"record_count":
{ Args: { "p_counted_units": number,"p_idempotency_key": string,"p_product_id": string,"p_reason": string }; Returns: string
                           },
"record_payment_redirect":
{ Args: { "p_order_id": string,"p_transaction_id": string }; Returns: undefined
                           },
"record_stock_entry":
{ Args: { "p_idempotency_key": string,"p_product_id": string,"p_reason"?: string,"p_reference": string,"p_units": number }; Returns: string
                           },
"record_waste":
{ Args: { "p_idempotency_key": string,"p_product_id": string,"p_reason": string,"p_units": number }; Returns: string
                           },
"release_expired_reservations":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"release_reservation":
{ Args: { "p_reference": string }; Returns: number
                           },
"reserve_stock":
{ Args: { "p_items": Json,"p_reference": string,"p_ttl_minutes"?: number }; Returns: string[]
                           },
"set_cart_item":
{ Args: { "p_product_id": string,"p_quantity": number }; Returns: undefined
                           },
"start_payment":
{ Args: { "p_idempotency_key": string,"p_order_id": string }; Returns: Json
                           },
"store_payment_event":
{ Args: { "p_checksum": string,"p_payload": Json,"p_source": string }; Returns: Json
                           }
          }
          Enums: {
            "action_status": "queued"|"processing"|"succeeded"|"failed","customer_type": "retail"|"wholesale","document_type": "cc"|"ce"|"nit"|"passport","fulfillment_method": "pickup"|"delivery","inventory_movement_type": "purchase_in"|"web_sale"|"pos_sale"|"adjustment"|"waste"|"return_in"|"reservation"|"reservation_release","legal_document": "age_gate"|"terms"|"privacy","order_channel": "web"|"pos","order_status": "draft"|"awaiting_payment"|"paid"|"preparing"|"out_for_delivery"|"delivered"|"cancelled"|"refunded","payment_attempt_status": "pending"|"approved"|"declined"|"voided"|"error"|"abandoned","product_origin": "national"|"imported","reservation_status": "active"|"consumed"|"released"|"expired","staff_role": "admin"|"cashier"|"courier"|"warehouse","wholesale_status": "pending"|"approved"|"rejected"
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
            "action_status": ["queued", "processing", "succeeded", "failed"],"customer_type": ["retail", "wholesale"],"document_type": ["cc", "ce", "nit", "passport"],"fulfillment_method": ["pickup", "delivery"],"inventory_movement_type": ["purchase_in", "web_sale", "pos_sale", "adjustment", "waste", "return_in", "reservation", "reservation_release"],"legal_document": ["age_gate", "terms", "privacy"],"order_channel": ["web", "pos"],"order_status": ["draft", "awaiting_payment", "paid", "preparing", "out_for_delivery", "delivered", "cancelled", "refunded"],"payment_attempt_status": ["pending", "approved", "declined", "voided", "error", "abandoned"],"product_origin": ["national", "imported"],"reservation_status": ["active", "consumed", "released", "expired"],"staff_role": ["admin", "cashier", "courier", "warehouse"],"wholesale_status": ["pending", "approved", "rejected"]
          }
        }
} as const
