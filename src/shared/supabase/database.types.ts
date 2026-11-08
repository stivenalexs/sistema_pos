
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
                },"couriers": {
                  Row: {
                    "created_at": string,"full_name": string,"id": string,"is_active": boolean,"phone": string | null,"provider_id": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"full_name": string,"id": string,"is_active"?: boolean,"phone"?: string | null,"provider_id": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"full_name"?: string,"id"?: string,"is_active"?: boolean,"phone"?: string | null,"provider_id"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "couriers_provider_id_fkey"
      columns: ["provider_id"]
isOneToOne: false
      referencedRelation: "delivery_providers"
      referencedColumns: ["id"]
    }
                  ]
                },"credit_notes": {
                  Row: {
                    "attempts": number,"created_at": string,"cufe": string | null,"factus_number": string | null,"id": string,"invoice_id": string,"last_error": string | null,"reason": string,"reference_code": string,"request": Json | null,"requested_by": string | null,"response": Json | null,"status": Database["public"]['Enums']["invoice_status"],"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "attempts"?: number,"created_at"?: string,"cufe"?: string | null,"factus_number"?: string | null,"id"?: string,"invoice_id": string,"last_error"?: string | null,"reason": string,"reference_code": string,"request"?: Json | null,"requested_by"?: string | null,"response"?: Json | null,"status"?: Database["public"]['Enums']["invoice_status"],"updated_at"?: string
                  }
                  Update: {
                    "attempts"?: number,"created_at"?: string,"cufe"?: string | null,"factus_number"?: string | null,"id"?: string,"invoice_id"?: string,"last_error"?: string | null,"reason"?: string,"reference_code"?: string,"request"?: Json | null,"requested_by"?: string | null,"response"?: Json | null,"status"?: Database["public"]['Enums']["invoice_status"],"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "credit_notes_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: true
      referencedRelation: "invoices"
      referencedColumns: ["id"]
    }
                  ]
                },"customer_addresses": {
                  Row: {
                    "address_line": string,"created_at": string,"customer_id": string,"details": string | null,"id": string,"label": string,"location": unknown,"updated_at": string,"zone_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "address_line": string,"created_at"?: string,"customer_id": string,"details"?: string | null,"id"?: string,"label": string,"location": unknown,"updated_at"?: string,"zone_id": string
                  }
                  Update: {
                    "address_line"?: string,"created_at"?: string,"customer_id"?: string,"details"?: string | null,"id"?: string,"label"?: string,"location"?: unknown,"updated_at"?: string,"zone_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "customer_addresses_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "customer_addresses_zone_id_fkey"
      columns: ["zone_id"]
isOneToOne: false
      referencedRelation: "delivery_zones"
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
                },"delivery_attempts": {
                  Row: {
                    "actor_id": string,"created_at": string,"failure_reason": string | null,"id": string,"idempotency_key": string,"location": unknown,"notes": string | null,"order_id": string,"outcome": Database["public"]['Enums']["delivery_outcome"]
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id": string,"created_at"?: string,"failure_reason"?: string | null,"id"?: string,"idempotency_key": string,"location"?: unknown,"notes"?: string | null,"order_id": string,"outcome": Database["public"]['Enums']["delivery_outcome"]
                  }
                  Update: {
                    "actor_id"?: string,"created_at"?: string,"failure_reason"?: string | null,"id"?: string,"idempotency_key"?: string,"location"?: unknown,"notes"?: string | null,"order_id"?: string,"outcome"?: Database["public"]['Enums']["delivery_outcome"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "delivery_attempts_order_id_fkey"
      columns: ["order_id"]
isOneToOne: false
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"delivery_fee_rules": {
                  Row: {
                    "created_at": string,"customer_type": Database["public"]['Enums']["customer_type"] | null,"fee_cop": number,"id": string,"is_active": boolean,"max_distance_m": number | null,"min_boxes": number | null,"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"customer_type"?: Database["public"]['Enums']["customer_type"] | null,"fee_cop": number,"id"?: string,"is_active"?: boolean,"max_distance_m"?: number | null,"min_boxes"?: number | null,"name": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"customer_type"?: Database["public"]['Enums']["customer_type"] | null,"fee_cop"?: number,"id"?: string,"is_active"?: boolean,"max_distance_m"?: number | null,"min_boxes"?: number | null,"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"delivery_proofs": {
                  Row: {
                    "age_confirmed": boolean,"attempt_id": string,"delivered_at": string,"delivered_by": string,"id": string,"order_id": string,"recipient_document_number": string,"recipient_name": string,"signature_path": string
                  }
                  ComputedFields: never
                  Insert: {
                    "age_confirmed": boolean,"attempt_id": string,"delivered_at"?: string,"delivered_by": string,"id"?: string,"order_id": string,"recipient_document_number": string,"recipient_name": string,"signature_path": string
                  }
                  Update: {
                    "age_confirmed"?: boolean,"attempt_id"?: string,"delivered_at"?: string,"delivered_by"?: string,"id"?: string,"order_id"?: string,"recipient_document_number"?: string,"recipient_name"?: string,"signature_path"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "delivery_proofs_attempt_id_fkey"
      columns: ["attempt_id"]
isOneToOne: true
      referencedRelation: "delivery_attempts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "delivery_proofs_order_id_fkey"
      columns: ["order_id"]
isOneToOne: true
      referencedRelation: "orders"
      referencedColumns: ["id"]
    }
                  ]
                },"delivery_providers": {
                  Row: {
                    "created_at": string,"id": string,"is_active": boolean,"kind": Database["public"]['Enums']["delivery_provider_kind"],"name": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"kind": Database["public"]['Enums']["delivery_provider_kind"],"name": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"is_active"?: boolean,"kind"?: Database["public"]['Enums']["delivery_provider_kind"],"name"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"delivery_zones": {
                  Row: {
                    "created_at": string,"dane_code": string,"id": string,"is_active": boolean,"municipality": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"dane_code": string,"id"?: string,"is_active"?: boolean,"municipality": string,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"dane_code"?: string,"id"?: string,"is_active"?: boolean,"municipality"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    
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
                },"invoice_lines": {
                  Row: {
                    "ad_valorem_cop": number,"base_cop": number,"exploitation_cop": number,"final_cop": number,"id": string,"invoice_id": string,"iva_cop": number,"line_kind": string,"name": string,"net_cop": number | null,"product_id": string | null,"quantity_units": number,"sku": string,"specific_cop": number
                  }
                  ComputedFields: never
                  Insert: {
                    "ad_valorem_cop": number,"base_cop": number,"exploitation_cop": number,"final_cop": number,"id"?: string,"invoice_id": string,"iva_cop": number,"line_kind"?: string,"name": string,"net_cop"?: never,"product_id"?: string | null,"quantity_units": number,"sku": string,"specific_cop": number
                  }
                  Update: {
                    "ad_valorem_cop"?: number,"base_cop"?: number,"exploitation_cop"?: number,"final_cop"?: number,"id"?: string,"invoice_id"?: string,"iva_cop"?: number,"line_kind"?: string,"name"?: string,"net_cop"?: never,"product_id"?: string | null,"quantity_units"?: number,"sku"?: string,"specific_cop"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoice_lines_invoice_id_fkey"
      columns: ["invoice_id"]
isOneToOne: false
      referencedRelation: "invoices"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "invoice_lines_product_id_fkey"
      columns: ["product_id"]
isOneToOne: false
      referencedRelation: "products"
      referencedColumns: ["id"]
    }
                  ]
                },"invoices": {
                  Row: {
                    "accepted_at": string | null,"attempts": number,"base_cop": number,"created_at": string,"cufe": string | null,"customer": NonNullable<Json>,"dian_errors": Json | null,"exploitation_cop": number,"factus_number": string | null,"id": string,"iva_cop": number,"last_error": string | null,"order_id": string,"participation_cop": number,"payment_method_code": string,"public_url": string | null,"qr_url": string | null,"reference_code": string,"rejected_at": string | null,"request": Json | null,"response": Json | null,"sent_at": string | null,"status": Database["public"]['Enums']["invoice_status"],"total_cop": number,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"attempts"?: number,"base_cop": number,"created_at"?: string,"cufe"?: string | null,"customer": NonNullable<Json>,"dian_errors"?: Json | null,"exploitation_cop": number,"factus_number"?: string | null,"id"?: string,"iva_cop": number,"last_error"?: string | null,"order_id": string,"participation_cop": number,"payment_method_code": string,"public_url"?: string | null,"qr_url"?: string | null,"reference_code": string,"rejected_at"?: string | null,"request"?: Json | null,"response"?: Json | null,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["invoice_status"],"total_cop": number,"updated_at"?: string
                  }
                  Update: {
                    "accepted_at"?: string | null,"attempts"?: number,"base_cop"?: number,"created_at"?: string,"cufe"?: string | null,"customer"?: NonNullable<Json>,"dian_errors"?: Json | null,"exploitation_cop"?: number,"factus_number"?: string | null,"id"?: string,"iva_cop"?: number,"last_error"?: string | null,"order_id"?: string,"participation_cop"?: number,"payment_method_code"?: string,"public_url"?: string | null,"qr_url"?: string | null,"reference_code"?: string,"rejected_at"?: string | null,"request"?: Json | null,"response"?: Json | null,"sent_at"?: string | null,"status"?: Database["public"]['Enums']["invoice_status"],"total_cop"?: number,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "invoices_order_id_fkey"
      columns: ["order_id"]
isOneToOne: true
      referencedRelation: "orders"
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
                    "age_confirmed": boolean | null,"assigned_at": string | null,"cancel_after": string | null,"cancel_reason": string | null,"cancelled_at": string | null,"cash_received_cop": number | null,"cashier_id": string | null,"change_cop": number | null,"channel": Database["public"]['Enums']["order_channel"],"courier_id": string | null,"created_at": string,"customer_id": string | null,"delivered_at": string | null,"delivery_address": Json | null,"delivery_distance_m": number | null,"delivery_external_ref": string | null,"delivery_fee_cop": number,"delivery_provider_id": string | null,"fulfillment": Database["public"]['Enums']["fulfillment_method"],"id": string,"idempotency_key": string,"needs_refund": boolean,"paid_at": string | null,"payment_deadline": string | null,"pos_payment_method": string | null,"refund_reason": string | null,"sale_unit": string,"sale_zone_id": string | null,"status": Database["public"]['Enums']["order_status"],"subtotal_cop": number,"total_base_units": number,"total_boxes": number,"total_cop": number,"updated_at": string,"void_reason": string | null,"voided_at": string | null,"voided_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "age_confirmed"?: boolean | null,"assigned_at"?: string | null,"cancel_after"?: string | null,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"cash_received_cop"?: number | null,"cashier_id"?: string | null,"change_cop"?: number | null,"channel": Database["public"]['Enums']["order_channel"],"courier_id"?: string | null,"created_at"?: string,"customer_id"?: string | null,"delivered_at"?: string | null,"delivery_address"?: Json | null,"delivery_distance_m"?: number | null,"delivery_external_ref"?: string | null,"delivery_fee_cop"?: number,"delivery_provider_id"?: string | null,"fulfillment": Database["public"]['Enums']["fulfillment_method"],"id"?: string,"idempotency_key": string,"needs_refund"?: boolean,"paid_at"?: string | null,"payment_deadline"?: string | null,"pos_payment_method"?: string | null,"refund_reason"?: string | null,"sale_unit": string,"sale_zone_id"?: string | null,"status"?: Database["public"]['Enums']["order_status"],"subtotal_cop": number,"total_base_units": number,"total_boxes"?: number,"total_cop": number,"updated_at"?: string,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Update: {
                    "age_confirmed"?: boolean | null,"assigned_at"?: string | null,"cancel_after"?: string | null,"cancel_reason"?: string | null,"cancelled_at"?: string | null,"cash_received_cop"?: number | null,"cashier_id"?: string | null,"change_cop"?: number | null,"channel"?: Database["public"]['Enums']["order_channel"],"courier_id"?: string | null,"created_at"?: string,"customer_id"?: string | null,"delivered_at"?: string | null,"delivery_address"?: Json | null,"delivery_distance_m"?: number | null,"delivery_external_ref"?: string | null,"delivery_fee_cop"?: number,"delivery_provider_id"?: string | null,"fulfillment"?: Database["public"]['Enums']["fulfillment_method"],"id"?: string,"idempotency_key"?: string,"needs_refund"?: boolean,"paid_at"?: string | null,"payment_deadline"?: string | null,"pos_payment_method"?: string | null,"refund_reason"?: string | null,"sale_unit"?: string,"sale_zone_id"?: string | null,"status"?: Database["public"]['Enums']["order_status"],"subtotal_cop"?: number,"total_base_units"?: number,"total_boxes"?: number,"total_cop"?: number,"updated_at"?: string,"void_reason"?: string | null,"voided_at"?: string | null,"voided_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "orders_courier_id_fkey"
      columns: ["courier_id"]
isOneToOne: false
      referencedRelation: "couriers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_delivery_provider_id_fkey"
      columns: ["delivery_provider_id"]
isOneToOne: false
      referencedRelation: "delivery_providers"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "orders_sale_zone_id_fkey"
      columns: ["sale_zone_id"]
isOneToOne: false
      referencedRelation: "delivery_zones"
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
                    "alcohol_degree": number | null,"allow_retail_by_unit": boolean,"brand": string | null,"created_at": string,"description": string | null,"id": string,"image_path": string | null,"is_active": boolean,"is_fla": boolean,"low_stock_threshold": number,"name": string,"origin": Database["public"]['Enums']["product_origin"],"retail_min_units": number,"sku": string,"tax_category": Database["public"]['Enums']["tax_category"] | null,"units_per_box": number,"updated_at": string,"volume_ml": number | null,"web_safety_stock": number,"wholesale_min_boxes": number
                  }
                  ComputedFields: never
                  Insert: {
                    "alcohol_degree"?: number | null,"allow_retail_by_unit"?: boolean,"brand"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"image_path"?: string | null,"is_active"?: boolean,"is_fla"?: boolean,"low_stock_threshold"?: number,"name": string,"origin": Database["public"]['Enums']["product_origin"],"retail_min_units"?: number,"sku": string,"tax_category"?: Database["public"]['Enums']["tax_category"] | null,"units_per_box": number,"updated_at"?: string,"volume_ml"?: number | null,"web_safety_stock"?: number,"wholesale_min_boxes"?: number
                  }
                  Update: {
                    "alcohol_degree"?: number | null,"allow_retail_by_unit"?: boolean,"brand"?: string | null,"created_at"?: string,"description"?: string | null,"id"?: string,"image_path"?: string | null,"is_active"?: boolean,"is_fla"?: boolean,"low_stock_threshold"?: number,"name"?: string,"origin"?: Database["public"]['Enums']["product_origin"],"retail_min_units"?: number,"sku"?: string,"tax_category"?: Database["public"]['Enums']["tax_category"] | null,"units_per_box"?: number,"updated_at"?: string,"volume_ml"?: number | null,"web_safety_stock"?: number,"wholesale_min_boxes"?: number
                  }
                  Relationships: [
                    
                  ]
                },"sales_block_changes": {
                  Row: {
                    "actor_id": string | null,"block_id": string,"created_at": string,"id": string,"new_row": Json | null,"old_row": Json | null,"operation": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor_id"?: string | null,"block_id": string,"created_at"?: string,"id"?: string,"new_row"?: Json | null,"old_row"?: Json | null,"operation": string
                  }
                  Update: {
                    "actor_id"?: string | null,"block_id"?: string,"created_at"?: string,"id"?: string,"new_row"?: Json | null,"old_row"?: Json | null,"operation"?: string
                  }
                  Relationships: [
                    
                  ]
                },"sales_blocks": {
                  Row: {
                    "channels": (string)[],"created_at": string,"created_by": string | null,"end_time": string | null,"ends_at": string | null,"id": string,"is_active": boolean,"kind": Database["public"]['Enums']["sales_block_kind"],"message": string,"name": string,"start_time": string | null,"starts_at": string | null,"updated_at": string,"updated_by": string | null,"weekdays": (number)[] | null,"zone_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "channels"?: (string)[],"created_at"?: string,"created_by"?: string | null,"end_time"?: string | null,"ends_at"?: string | null,"id"?: string,"is_active"?: boolean,"kind": Database["public"]['Enums']["sales_block_kind"],"message": string,"name": string,"start_time"?: string | null,"starts_at"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"weekdays"?: (number)[] | null,"zone_id"?: string | null
                  }
                  Update: {
                    "channels"?: (string)[],"created_at"?: string,"created_by"?: string | null,"end_time"?: string | null,"ends_at"?: string | null,"id"?: string,"is_active"?: boolean,"kind"?: Database["public"]['Enums']["sales_block_kind"],"message"?: string,"name"?: string,"start_time"?: string | null,"starts_at"?: string | null,"updated_at"?: string,"updated_by"?: string | null,"weekdays"?: (number)[] | null,"zone_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "sales_blocks_zone_id_fkey"
      columns: ["zone_id"]
isOneToOne: false
      referencedRelation: "delivery_zones"
      referencedColumns: ["id"]
    }
                  ]
                },"staff_changes": {
                  Row: {
                    "change": string,"changed_by": string | null,"created_at": string,"id": string,"previous_role": string | null,"reason": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "change": string,"changed_by"?: string | null,"created_at"?: string,"id"?: string,"previous_role"?: string | null,"reason": string,"user_id": string
                  }
                  Update: {
                    "change"?: string,"changed_by"?: string | null,"created_at"?: string,"id"?: string,"previous_role"?: string | null,"reason"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"staff_invitations": {
                  Row: {
                    "accepted_at": string | null,"created_at": string,"email": string,"expires_at": string,"full_name": string,"id": string,"invited_by": string | null,"phone": string | null,"revoked_at": string | null,"staff_role": Database["public"]['Enums']["staff_role"],"status": Database["public"]['Enums']["staff_invitation_status"],"token_hash": string,"updated_at": string,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "accepted_at"?: string | null,"created_at"?: string,"email": string,"expires_at"?: string,"full_name": string,"id"?: string,"invited_by"?: string | null,"phone"?: string | null,"revoked_at"?: string | null,"staff_role": Database["public"]['Enums']["staff_role"],"status"?: Database["public"]['Enums']["staff_invitation_status"],"token_hash": string,"updated_at"?: string,"user_id"?: string | null
                  }
                  Update: {
                    "accepted_at"?: string | null,"created_at"?: string,"email"?: string,"expires_at"?: string,"full_name"?: string,"id"?: string,"invited_by"?: string | null,"phone"?: string | null,"revoked_at"?: string | null,"staff_role"?: Database["public"]['Enums']["staff_role"],"status"?: Database["public"]['Enums']["staff_invitation_status"],"token_hash"?: string,"updated_at"?: string,"user_id"?: string | null
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
                },"tax_rates": {
                  Row: {
                    "ad_valorem_pct": number,"created_at": string,"exploitation_pct": number,"id": string,"specific_per_degree_cop": number,"tax_category": Database["public"]['Enums']["tax_category"],"year": number
                  }
                  ComputedFields: never
                  Insert: {
                    "ad_valorem_pct": number,"created_at"?: string,"exploitation_pct"?: number,"id"?: string,"specific_per_degree_cop": number,"tax_category": Database["public"]['Enums']["tax_category"],"year": number
                  }
                  Update: {
                    "ad_valorem_pct"?: number,"created_at"?: string,"exploitation_pct"?: number,"id"?: string,"specific_per_degree_cop"?: number,"tax_category"?: Database["public"]['Enums']["tax_category"],"year"?: number
                  }
                  Relationships: [
                    
                  ]
                },"wholesale_reviews": {
                  Row: {
                    "created_at": string,"customer_id": string,"decision": Database["public"]['Enums']["wholesale_status"],"id": string,"reason": string,"reviewed_by": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"customer_id": string,"decision": Database["public"]['Enums']["wholesale_status"],"id"?: string,"reason": string,"reviewed_by"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"customer_id"?: string,"decision"?: Database["public"]['Enums']["wholesale_status"],"id"?: string,"reason"?: string,"reviewed_by"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "wholesale_reviews_customer_id_fkey"
      columns: ["customer_id"]
isOneToOne: false
      referencedRelation: "customers"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "admin_list_staff":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"admin_list_wholesale":
{ Args: { "p_status"?: string }; Returns: Json
                           },
"admin_summary":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"apply_payment_event":
{ Args: { "p_event_id": string }; Returns: string
                           },
"assign_delivery":
{ Args: { "p_courier_id"?: string,"p_external_ref"?: string,"p_order_id": string,"p_provider_id": string }; Returns: undefined
                           },
"can_deliver_order":
{ Args: { "p_order_id": string }; Returns: boolean
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
"clear_mismatched_payment_hint":
{ Args: { "p_attempt_id": string,"p_transaction_id": string,"p_wompi_reference": string }; Returns: boolean
                           },
"complete_action":
{ Args: { "p_action_id": string,"p_result"?: Json }; Returns: undefined
                           },
"consume_reservation":
{ Args: { "p_idempotency_key": string,"p_items": Json,"p_reference": string }; Returns: number
                           },
"create_pos_sale":
{ Args: { "p_age_confirmed": boolean,"p_cash_received_cop": number,"p_customer_id": string,"p_idempotency_key": string,"p_items": Json,"p_payment_method": string }; Returns: Json
                           },
"deactivate_staff":
{ Args: { "p_reason": string,"p_user_id": string }; Returns: Json
                           },
"delete_delivery_address":
{ Args: { "p_address_id": string }; Returns: boolean
                           },
"enqueue_action":
{ Args: { "p_idempotency_key": string,"p_max_attempts"?: number,"p_payload"?: Json,"p_type": string,"p_user_id": string }; Returns: {
              "created": boolean,"tracking_id": string
            }[]
                           },
"fail_action":
{ Args: { "p_action_id": string,"p_error": string,"p_permanent"?: boolean }; Returns: Database["public"]['Enums']["action_status"]
                           },
"find_pos_customer":
{ Args: { "p_query": string }; Returns: Json
                           },
"get_cart_items":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"get_catalog":
{ Args: Record<PropertyKey, never>; Returns: {
              "brand": string,"description": string,"min_quantity": number,"name": string,"origin": Database["public"]['Enums']["product_origin"],"price_cop": number,"price_list_id": string,"product_id": string,"sale_unit": string,"sku": string,"units_per_box": number,"volume_ml": number
            }[]
                           },
"get_delivery_addresses":
{ Args: Record<PropertyKey, never>; Returns: {
              "address_line": string,"details": string,"distance_m": number,"id": string,"label": string,"lat": number,"lng": number,"municipality": string,"zone_active": boolean,"zone_id": string
            }[]
                           },
"get_pos_catalog":
{ Args: { "p_customer_id"?: string }; Returns: Json
                           },
"get_sales_block":
{ Args: { "p_channel"?: string,"p_zone_id"?: string }; Returns: Json
                           },
"get_web_availability":
{ Args: Record<PropertyKey, never>; Returns: {
              "available_sale_units": number,"available_units": number,"product_id": string
            }[]
                           },
"invite_staff":
{ Args: { "p_email": string,"p_full_name": string,"p_phone": string,"p_staff_role": string }; Returns: Json
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
{ Args: { "p_address_id"?: string,"p_fulfillment"?: Database["public"]['Enums']["fulfillment_method"],"p_idempotency_key": string }; Returns: Json
                           },
"prepare_invoice":
{ Args: { "p_order_id": string }; Returns: Json
                           },
"quote_delivery":
{ Args: { "p_address_id": string }; Returns: Json
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
"record_credit_note_result":
{ Args: { "p_credit_note_id": string,"p_error"?: string,"p_outcome": string,"p_request": Json,"p_response": Json }; Returns: undefined
                           },
"record_delivery_attempt":
{ Args: { "p_actor_id": string,"p_age_confirmed": boolean,"p_document_number": string,"p_failure_reason": string,"p_idempotency_key": string,"p_lat"?: number,"p_lng"?: number,"p_notes": string,"p_order_id": string,"p_outcome": Database["public"]['Enums']["delivery_outcome"],"p_recipient_name": string,"p_signature_path": string }; Returns: Json
                           },
"record_invoice_result":
{ Args: { "p_error"?: string,"p_invoice_id": string,"p_outcome": string,"p_request": Json,"p_response": Json }; Returns: undefined
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
"request_credit_note":
{ Args: { "p_invoice_id": string,"p_reason": string }; Returns: string
                           },
"reserve_stock":
{ Args: { "p_items": Json,"p_reference": string,"p_ttl_minutes"?: number }; Returns: string[]
                           },
"review_wholesale":
{ Args: { "p_customer_id": string,"p_decision": string,"p_reason": string }; Returns: Json
                           },
"revoke_staff_invitation":
{ Args: { "p_invitation_id": string }; Returns: boolean
                           },
"save_delivery_address":
{ Args: { "p_address_line": string,"p_details": string,"p_label": string,"p_lat": number,"p_lng": number,"p_zone_id": string }; Returns: string
                           },
"set_cart_item":
{ Args: { "p_product_id": string,"p_quantity": number }; Returns: undefined
                           },
"start_payment":
{ Args: { "p_idempotency_key": string,"p_order_id": string }; Returns: Json
                           },
"store_payment_event":
{ Args: { "p_checksum": string,"p_payload": Json,"p_source": string }; Returns: Json
                           },
"void_pos_sale":
{ Args: { "p_order_id": string,"p_reason": string }; Returns: Json
                           }
          }
          Enums: {
            "action_status": "queued"|"processing"|"succeeded"|"failed","customer_type": "retail"|"wholesale","delivery_outcome": "delivered"|"failed","delivery_provider_kind": "own"|"third_party","document_type": "cc"|"ce"|"nit"|"passport","fulfillment_method": "pickup"|"delivery","inventory_movement_type": "purchase_in"|"web_sale"|"pos_sale"|"adjustment"|"waste"|"return_in"|"reservation"|"reservation_release","invoice_status": "pending"|"sent"|"accepted"|"rejected","legal_document": "age_gate"|"terms"|"privacy","order_channel": "web"|"pos","order_status": "draft"|"awaiting_payment"|"paid"|"preparing"|"out_for_delivery"|"delivered"|"cancelled"|"refunded","payment_attempt_status": "pending"|"approved"|"declined"|"voided"|"error"|"abandoned","product_origin": "national"|"imported","reservation_status": "active"|"consumed"|"released"|"expired","sales_block_kind": "date_range"|"weekly","staff_invitation_status": "pending"|"accepted"|"revoked","staff_role": "admin"|"cashier"|"courier"|"warehouse","tax_category": "spirits"|"wine"|"non_wine_aperitif","wholesale_status": "pending"|"approved"|"rejected"
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
            "action_status": ["queued", "processing", "succeeded", "failed"],"customer_type": ["retail", "wholesale"],"delivery_outcome": ["delivered", "failed"],"delivery_provider_kind": ["own", "third_party"],"document_type": ["cc", "ce", "nit", "passport"],"fulfillment_method": ["pickup", "delivery"],"inventory_movement_type": ["purchase_in", "web_sale", "pos_sale", "adjustment", "waste", "return_in", "reservation", "reservation_release"],"invoice_status": ["pending", "sent", "accepted", "rejected"],"legal_document": ["age_gate", "terms", "privacy"],"order_channel": ["web", "pos"],"order_status": ["draft", "awaiting_payment", "paid", "preparing", "out_for_delivery", "delivered", "cancelled", "refunded"],"payment_attempt_status": ["pending", "approved", "declined", "voided", "error", "abandoned"],"product_origin": ["national", "imported"],"reservation_status": ["active", "consumed", "released", "expired"],"sales_block_kind": ["date_range", "weekly"],"staff_invitation_status": ["pending", "accepted", "revoked"],"staff_role": ["admin", "cashier", "courier", "warehouse"],"tax_category": ["spirits", "wine", "non_wine_aperitif"],"wholesale_status": ["pending", "approved", "rejected"]
          }
        }
} as const
