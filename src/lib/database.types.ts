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
      categoria_produto_opcionais: {
        Row: {
          categoria_id: string
          categoria_opcional_id: string
          id: string
          loja_id: string
        }
        Insert: {
          categoria_id: string
          categoria_opcional_id: string
          id?: string
          loja_id: string
        }
        Update: {
          categoria_id?: string
          categoria_opcional_id?: string
          id?: string
          loja_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "categoria_produto_opcionais_categoria_id_loja_id_fkey"
            columns: ["categoria_id", "loja_id"]
            isOneToOne: false
            referencedRelation: "categorias"
            referencedColumns: ["id", "loja_id"]
          },
          {
            foreignKeyName: "categoria_produto_opcionais_categoria_opcional_id_loja_id_fkey"
            columns: ["categoria_opcional_id", "loja_id"]
            isOneToOne: false
            referencedRelation: "opcionais_categorias"
            referencedColumns: ["id", "loja_id"]
          },
          {
            foreignKeyName: "categoria_produto_opcionais_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "lojas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "categoria_produto_opcionais_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "vitrine_lojas"
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
      itens_pedido_opcionais: {
        Row: {
          id: string
          item_pedido_id: string
          nome_snapshot: string
          opcional_id: string | null
          preco_snapshot: number
          quantidade: number
        }
        Insert: {
          id?: string
          item_pedido_id: string
          nome_snapshot: string
          opcional_id?: string | null
          preco_snapshot: number
          quantidade: number
        }
        Update: {
          id?: string
          item_pedido_id?: string
          nome_snapshot?: string
          opcional_id?: string | null
          preco_snapshot?: number
          quantidade?: number
        }
        Relationships: [
          {
            foreignKeyName: "itens_pedido_opcionais_item_pedido_id_fkey"
            columns: ["item_pedido_id"]
            isOneToOne: false
            referencedRelation: "itens_pedido"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "itens_pedido_opcionais_opcional_id_fkey"
            columns: ["opcional_id"]
            isOneToOne: false
            referencedRelation: "opcionais"
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
          billing_provider: string | null
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
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          nome: string
          plano_id: string | null
          provider_subscription_id: string | null
          slug: string
          taxa_entrega_fora_zona: number | null
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
          billing_provider?: string | null
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
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          nome: string
          plano_id?: string | null
          provider_subscription_id?: string | null
          slug: string
          taxa_entrega_fora_zona?: number | null
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
          billing_provider?: string | null
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
          latitude?: number | null
          logo_url?: string | null
          longitude?: number | null
          nome?: string
          plano_id?: string | null
          provider_subscription_id?: string | null
          slug?: string
          taxa_entrega_fora_zona?: number | null
          telefone?: string | null
          tema?: Json
          timezone?: string
          whatsapp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lojas_plano_id_fkey"
            columns: ["plano_id"]
            isOneToOne: false
            referencedRelation: "planos"
            referencedColumns: ["id"]
          },
        ]
      }
      opcionais: {
        Row: {
          ativo: boolean
          atualizado_em: string
          categoria_opcional_id: string
          criado_em: string
          id: string
          loja_id: string
          nome: string
          ordem: number
          preco: number
        }
        Insert: {
          ativo?: boolean
          atualizado_em?: string
          categoria_opcional_id: string
          criado_em?: string
          id?: string
          loja_id: string
          nome: string
          ordem?: number
          preco: number
        }
        Update: {
          ativo?: boolean
          atualizado_em?: string
          categoria_opcional_id?: string
          criado_em?: string
          id?: string
          loja_id?: string
          nome?: string
          ordem?: number
          preco?: number
        }
        Relationships: [
          {
            foreignKeyName: "opcionais_categoria_opcional_id_fkey"
            columns: ["categoria_opcional_id"]
            isOneToOne: false
            referencedRelation: "opcionais_categorias"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opcionais_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "lojas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opcionais_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "vitrine_lojas"
            referencedColumns: ["id"]
          },
        ]
      }
      opcionais_categorias: {
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
            foreignKeyName: "opcionais_categorias_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "lojas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "opcionais_categorias_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "vitrine_lojas"
            referencedColumns: ["id"]
          },
        ]
      }
      pagamentos_assinatura: {
        Row: {
          competencia: string | null
          criado_em: string
          fatura_url: string | null
          id: string
          loja_id: string
          metodo: string | null
          provider: string
          provider_payment_id: string | null
          status: string
          valor: number
        }
        Insert: {
          competencia?: string | null
          criado_em?: string
          fatura_url?: string | null
          id?: string
          loja_id: string
          metodo?: string | null
          provider: string
          provider_payment_id?: string | null
          status: string
          valor: number
        }
        Update: {
          competencia?: string | null
          criado_em?: string
          fatura_url?: string | null
          id?: string
          loja_id?: string
          metodo?: string | null
          provider?: string
          provider_payment_id?: string | null
          status?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "pagamentos_assinatura_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "lojas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_assinatura_loja_id_fkey"
            columns: ["loja_id"]
            isOneToOne: false
            referencedRelation: "vitrine_lojas"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos: {
        Row: {
          criado_em: string
          cupom_codigo: string | null
          desconto: number
          endereco_entrega: Json | null
          forma_pagamento: string | null
          id: string
          idempotency_key: string | null
          loja_id: string
          nome_cliente: string
          observacoes: string | null
          status: string
          subtotal: number
          taxa_entrega: number
          telefone_cliente: string | null
          tipo_entrega: string
          token_acesso: string
          total: number
          troco_para: number | null
        }
        Insert: {
          criado_em?: string
          cupom_codigo?: string | null
          desconto?: number
          endereco_entrega?: Json | null
          forma_pagamento?: string | null
          id?: string
          idempotency_key?: string | null
          loja_id: string
          nome_cliente: string
          observacoes?: string | null
          status?: string
          subtotal: number
          taxa_entrega?: number
          telefone_cliente?: string | null
          tipo_entrega?: string
          token_acesso?: string
          total: number
          troco_para?: number | null
        }
        Update: {
          criado_em?: string
          cupom_codigo?: string | null
          desconto?: number
          endereco_entrega?: Json | null
          forma_pagamento?: string | null
          id?: string
          idempotency_key?: string | null
          loja_id?: string
          nome_cliente?: string
          observacoes?: string | null
          status?: string
          subtotal?: number
          taxa_entrega?: number
          telefone_cliente?: string | null
          tipo_entrega?: string
          token_acesso?: string
          total?: number
          troco_para?: number | null
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
      planos: {
        Row: {
          ativo: boolean
          criado_em: string
          id: string
          intervalo: string
          nome: string
          preco: number
          provider_price_id: string | null
        }
        Insert: {
          ativo?: boolean
          criado_em?: string
          id?: string
          intervalo?: string
          nome: string
          preco: number
          provider_price_id?: string | null
        }
        Update: {
          ativo?: boolean
          criado_em?: string
          id?: string
          intervalo?: string
          nome?: string
          preco?: number
          provider_price_id?: string | null
        }
        Relationships: []
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
          cep_fim: number | null
          cep_inicio: number | null
          id: string
          pedido_minimo_gratis: number | null
          raio_max_km: number | null
          taxa: number
          zona_id: string
        }
        Insert: {
          cep_fim?: number | null
          cep_inicio?: number | null
          id?: string
          pedido_minimo_gratis?: number | null
          raio_max_km?: number | null
          taxa: number
          zona_id: string
        }
        Update: {
          cep_fim?: number | null
          cep_inicio?: number | null
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
      webhook_eventos_billing: {
        Row: {
          criado_em: string
          evento_id: string
          id: string
          payload: Json
          processado: boolean
          provider: string
          tipo: string
        }
        Insert: {
          criado_em?: string
          evento_id: string
          id?: string
          payload: Json
          processado?: boolean
          provider: string
          tipo: string
        }
        Update: {
          criado_em?: string
          evento_id?: string
          id?: string
          payload?: Json
          processado?: boolean
          provider?: string
          tipo?: string
        }
        Relationships: []
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
          logo_url: string | null
          nome: string | null
          slug: string | null
          taxa_entrega_fora_zona: number | null
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
          logo_url?: string | null
          nome?: string | null
          slug?: string | null
          taxa_entrega_fora_zona?: number | null
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
          logo_url?: string | null
          nome?: string | null
          slug?: string | null
          taxa_entrega_fora_zona?: number | null
          telefone?: string | null
          tema?: Json | null
          timezone?: string | null
          whatsapp?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      criar_pedido: {
        Args: {
          p_cupom_codigo: string
          p_cupom_id: string
          p_desconto: number
          p_endereco_entrega: Json
          p_forma_pagamento: string
          p_idempotency_key?: string
          p_itens: Json
          p_loja_id: string
          p_nome_cliente: string
          p_observacoes: string
          p_subtotal: number
          p_taxa_entrega: number
          p_telefone_cliente: string
          p_tipo_entrega: string
          p_total: number
          p_troco_para: number
        }
        Returns: {
          pedido_id: string
          token_acesso: string
        }[]
      }
      garantir_loja_do_dono: {
        Args: { p_dono_id: string; p_email: string; p_versao_termos?: string }
        Returns: string
      }
      item_pedido_aceita_opcionais: {
        Args: { p_item_pedido_id: string }
        Returns: boolean
      }
      loja_esta_ativa: { Args: { p_loja_id: string }; Returns: boolean }
      loja_por_email_dono: {
        Args: { p_email: string }
        Returns: {
          assinatura_atualizada_em: string | null
          assinatura_fim_periodo: string | null
          assinatura_inicio: string | null
          assinatura_status: string
          ativo: boolean
          atualizado_em: string
          billing_provider: string | null
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
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          nome: string
          plano_id: string | null
          provider_subscription_id: string | null
          slug: string
          taxa_entrega_fora_zona: number | null
          telefone: string | null
          tema: Json
          timezone: string
          whatsapp: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "lojas"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      loja_por_subscription_id: {
        Args: { p_provider: string; p_subscription_id: string }
        Returns: {
          assinatura_atualizada_em: string | null
          assinatura_fim_periodo: string | null
          assinatura_inicio: string | null
          assinatura_status: string
          ativo: boolean
          atualizado_em: string
          billing_provider: string | null
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
          latitude: number | null
          logo_url: string | null
          longitude: number | null
          nome: string
          plano_id: string | null
          provider_subscription_id: string | null
          slug: string
          taxa_entrega_fora_zona: number | null
          telefone: string | null
          tema: Json
          timezone: string
          whatsapp: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "lojas"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      pedido_aceita_itens: { Args: { p_pedido_id: string }; Returns: boolean }
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
