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
      bairros_zona: {
        Row: {
          id: string
          nome: string
          zona_id: string
        }
        Insert: {
          id?: string
          nome: string
          zona_id: string
        }
        Update: {
          id?: string
          nome?: string
          zona_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bairros_zona_zona_id_fkey"
            columns: ["zona_id"]
            isOneToOne: false
            referencedRelation: "zonas_entrega"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias: {
        Row: {
          criado_em: string
          id: string
          loja_id: string
          nome: string
          ordem: number
        }
        Insert: {
          criado_em?: string
          id?: string
          loja_id: string
          nome: string
          ordem?: number
        }
        Update: {
          criado_em?: string
          id?: string
          loja_id?: string
          nome?: string
          ordem?: number
        }
        Relationships: [
          {
            foreignKeyName: "categorias_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "lojas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categorias_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "vitrine_lojas"
            referencedColumns: ["id"]
          },
        ]
      }
      cupons: {
        Row: {
          ativo: boolean
          codigo: string
          criado_em: string
          expira_em: string | null
          id: string
          loja_id: string
          pedido_minimo: number
          tipo: string
          usos_contagem: number
          usos_maximos: number | null
          valor: number
        }
        Insert: {
          ativo?: boolean
          codigo: string
          criado_em?: string
          expira_em?: string | null
          id?: string
          loja_id: string
          pedido_minimo?: number
          tipo: string
          usos_contagem?: number
          usos_maximos?: number | null
          valor: number
        }
        Update: {
          ativo?: boolean
          codigo?: string
          criado_em?: string
          expira_em?: string | null
          id?: string
          loja_id?: string
          pedido_minimo?: number
          tipo?: string
          usos_contagem?: number
          usos_maximos?: number | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "cupons_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "lojas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "cupons_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "vitrine_lojas"
            referencedColumns: ["id"]
          },
        ]
      }
      formas_pagamento: {
        Row: {
          config: Json
          id: string
          loja_id: string
          tipo: string
        }
        Insert: {
          config?: Json
          id?: string
          loja_id: string
          tipo: string
        }
        Update: {
          config?: Json
          id?: string
          loja_id?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "formas_pagamento_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "lojas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "formas_pagamento_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "vitrine_lojas"
            referencedColumns: ["id"]
          },
        ]
      }
      itens_pedido: {
        Row: {
          id: string
          nome: string
          pedido_id: string
          preco: number
          produto_id: string | null
          quantidade: number
        }
        Insert: {
          id?: string
          nome: string
          pedido_id: string
          preco: number
          produto_id?: string | null
          quantidade: number
        }
        Update: {
          id?: string
          nome?: string
          pedido_id?: string
          preco?: number
          produto_id?: string | null
          quantidade?: number
        }
        Relationships: [
          {
            foreignKeyName: "itens_pedido_pedido_id_fkey"
            columns: ["pedido_id"]
            isOneToOne: false
            referencedRelation: "pedidos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_pedido_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      lojas: {
        Row: {
          assinatura_atualizada_em: string | null
          assinatura_fim_periodo: string | null
          assinatura_inicio: string | null
          assinatura_status: string
          ativo: boolean
          atualizado_em: string
          consentimento_em: string | null
          consentimento_versao: string | null
          criado_em: string
          dono_id: string
          endereco_bairro: string | null
          endereco_cep: string | null
          endereco_cidade: string | null
          endereco_estado: string | null
          endereco_numero: string | null
          endereco_rua: string | null
          horarios: Json
          hotmart_plano: string | null
          hotmart_subscriber_code: string | null
          id: string
          nome: string
          slug: string
          telefone: string | null
          tema: Json
          timezone: string
          whatsapp: string | null
        }
        Insert: {
          assinatura_atualizada_em?: string | null
          assinatura_fim_periodo?: string | null
          assinatura_inicio?: string | null
          assinatura_status?: string
          ativo?: boolean
          atualizado_em?: string
          consentimento_em?: string | null
          consentimento_versao?: string | null
          criado_em?: string
          dono_id: string
          endereco_bairro?: string | null
          endereco_cep?: string | null
          endereco_cidade?: string | null
          endereco_estado?: string | null
          endereco_numero?: string | null
          endereco_rua?: string | null
          horarios?: Json
          hotmart_plano?: string | null
          hotmart_subscriber_code?: string | null
          id?: string
          nome: string
          slug: string
          telefone?: string | null
          tema?: Json
          timezone?: string
          whatsapp?: string | null
        }
        Update: {
          assinatura_atualizada_em?: string | null
          assinatura_fim_periodo?: string | null
          assinatura_inicio?: string | null
          assinatura_status?: string
          ativo?: boolean
          atualizado_em?: string
          consentimento_em?: string | null
          consentimento_versao?: string | null
          criado_em?: string
          dono_id?: string
          endereco_bairro?: string | null
          endereco_cep?: string | null
          endereco_cidade?: string | null
          endereco_estado?: string | null
          endereco_numero?: string | null
          endereco_rua?: string | null
          horarios?: Json
          hotmart_plano?: string | null
          hotmart_subscriber_code?: string | null
          id?: string
          nome?: string
          slug?: string
          telefone?: string | null
          tema?: Json
          timezone?: string
          whatsapp?: string | null
        }
        Relationships: []
      }
      pedidos: {
        Row: {
          criado_em: string
          cupom_codigo: string | null
          desconto: number
          endereco_entrega: Json | null
          forma_pagamento: string | null
          id: string
          loja_id: string
          nome_cliente: string
          observacoes: string | null
          status: string
          subtotal: number
          taxa_entrega: number
          telefone_cliente: string | null
          token_acesso: string
          total: number
        }
        Insert: {
          criado_em?: string
          cupom_codigo?: string | null
          desconto?: number
          endereco_entrega?: Json | null
          forma_pagamento?: string | null
          id?: string
          loja_id: string
          nome_cliente: string
          observacoes?: string | null
          status?: string
          subtotal: number
          taxa_entrega?: number
          telefone_cliente?: string | null
          token_acesso?: string
          total: number
        }
        Update: {
          criado_em?: string
          cupom_codigo?: string | null
          desconto?: number
          endereco_entrega?: Json | null
          forma_pagamento?: string | null
          id?: string
          loja_id?: string
          nome_cliente?: string
          observacoes?: string | null
          status?: string
          subtotal?: number
          taxa_entrega?: number
          telefone_cliente?: string | null
          token_acesso?: string
          total?: number
        }
        Relationships: [
          {
            foreignKeyName: "pedidos_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "lojas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pedidos_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "vitrine_lojas"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos: {
        Row: {
          atualizado_em: string
          categoria_id: string | null
          criado_em: string
          descricao: string | null
          disponivel: boolean
          foto_url: string | null
          id: string
          loja_id: string
          nome: string
          ordem: number
          preco: number
        }
        Insert: {
          atualizado_em?: string
          categoria_id?: string | null
          criado_em?: string
          descricao?: string | null
          disponivel?: boolean
          foto_url?: string | null
          id?: string
          loja_id: string
          nome: string
          ordem?: number
          preco: number
        }
        Update: {
          atualizado_em?: string
          categoria_id?: string | null
          criado_em?: string
          descricao?: string | null
          disponivel?: boolean
          foto_url?: string | null
          id?: string
          loja_id?: string
          nome?: string
          ordem?: number
          preco?: number
        }
        Relationships: [
          {
            foreignKeyName: "produtos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produtos_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "lojas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "produtos_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "vitrine_lojas"
            referencedColumns: ["id"]
          },
        ]
      }
      taxas_entrega: {
        Row: {
          id: string
          pedido_minimo_gratis: number | null
          raio_max_km: number | null
          taxa: number
          zona_id: string
        }
        Insert: {
          id?: string
          pedido_minimo_gratis?: number | null
          raio_max_km?: number | null
          taxa: number
          zona_id: string
        }
        Update: {
          id?: string
          pedido_minimo_gratis?: number | null
          raio_max_km?: number | null
          taxa?: number
          zona_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "taxas_entrega_zona_id_fkey"
            columns: ["zona_id"]
            isOneToOne: false
            referencedRelation: "zonas_entrega"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_eventos_hotmart: {
        Row: {
          email_comprador: string | null
          evento_id: string
          evento_tipo: string | null
          id: string
          loja_id: string | null
          payload: Json
          processado_em: string
        }
        Insert: {
          email_comprador?: string | null
          evento_id: string
          evento_tipo?: string | null
          id?: string
          loja_id?: string | null
          payload: Json
          processado_em?: string
        }
        Update: {
          email_comprador?: string | null
          evento_id?: string
          evento_tipo?: string | null
          id?: string
          loja_id?: string | null
          payload?: Json
          processado_em?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_eventos_hotmart_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "lojas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_eventos_hotmart_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "vitrine_lojas"
            referencedColumns: ["id"]
          },
        ]
      }
      zonas_entrega: {
        Row: {
          ativo: boolean
          id: string
          loja_id: string
          nome: string
          tipo: string
        }
        Insert: {
          ativo?: boolean
          id?: string
          loja_id: string
          nome: string
          tipo: string
        }
        Update: {
          ativo?: boolean
          id?: string
          loja_id?: string
          nome?: string
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "zonas_entrega_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "lojas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "zonas_entrega_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "vitrine_lojas"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      vitrine_lojas: {
        Row: {
          assinatura_fim_periodo: string | null
          assinatura_status: string | null
          ativo: boolean | null
          endereco_bairro: string | null
          endereco_cep: string | null
          endereco_cidade: string | null
          endereco_estado: string | null
          endereco_numero: string | null
          endereco_rua: string | null
          horarios: Json | null
          id: string | null
          nome: string | null
          slug: string | null
          telefone: string | null
          tema: Json | null
          timezone: string | null
          whatsapp: string | null
        }
        Insert: {
          assinatura_fim_periodo?: string | null
          assinatura_status?: string | null
          ativo?: boolean | null
          endereco_bairro?: string | null
          endereco_cep?: string | null
          endereco_cidade?: string | null
          endereco_estado?: string | null
          endereco_numero?: string | null
          endereco_rua?: string | null
          horarios?: Json | null
          id?: string | null
          nome?: string | null
          slug?: string | null
          telefone?: string | null
          tema?: Json | null
          timezone?: string | null
          whatsapp?: string | null
        }
        Update: {
          assinatura_fim_periodo?: string | null
          assinatura_status?: string | null
          ativo?: boolean | null
          endereco_bairro?: string | null
          endereco_cep?: string | null
          endereco_cidade?: string | null
          endereco_estado?: string | null
          endereco_numero?: string | null
          endereco_rua?: string | null
          horarios?: Json | null
          id?: string | null
          nome?: string | null
          slug?: string | null
          telefone?: string | null
          tema?: Json | null
          timezone?: string | null
          whatsapp?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      loja_esta_ativa: { Args: { p_loja_id: string }; Returns: boolean }
      pedido_aceita_itens: { Args: { p_pedido_id: string }; Returns: boolean }
      loja_por_email_dono: {
        Args: { p_email: string }
        Returns: Database["public"]["Tables"]["lojas"]["Row"][]
      }
    }
    Enums: {
      [_ in never]: never
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
    Enums: {},
  },
} as const
