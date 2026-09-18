"use client";

import { useState } from "react";
import { Icon, ICON_NAMES } from "@/components/Icon";
import {
  Badge,
  Button,
  Checkbox,
  Chip,
  DensitySwitch,
  Dialog,
  Empty,
  ErrorState,
  Field,
  IconButton,
  Input,
  KPI,
  KeyValue,
  NumCell,
  Odds,
  Panel,
  Radio,
  RangeField,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  TableSkeleton,
  Tabs,
  Td,
  Textarea,
  ThemeSwitch,
  Th,
  Tooltip,
  Tr,
  chanceStep,
} from "@/components/ui";
import { formatMoney, formatPercent, formatUnits } from "@/lib/format";

/**
 * Reference page for the Mesa de Operações system. It is deliberately dense and ruled: the gallery
 * is itself a screen built from the primitives, so anything that reads wrong here reads wrong in
 * the product. Copy stays pt-BR because the product's first language is pt-BR.
 */

function Section({ id, n, title, note, children }: { id: string; n: string; title: string; note?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="scroll-mt-16 border-t border-line pt-6 pb-10">
      <header className="mb-5 grid grid-cols-12 gap-4">
        <div className="col-span-12 flex items-baseline gap-3 md:col-span-4">
          <span className="nums text-label text-fg-dim">{n}</span>
          <h2 className="u-title text-h3 text-fg">{title}</h2>
        </div>
        {note && <p className="col-span-12 max-w-measure text-sm text-fg-muted md:col-span-7 md:col-start-6">{note}</p>}
      </header>
      {children}
    </section>
  );
}

/** A labelled cell of the gallery: the state's name in the system's own label style, then the thing. */
function Spec({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <span className="text-label u-label text-fg-dim">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

const TYPE_STEPS: { token: string; px: string; sample: string; className: string }[] = [
  { token: "text-mega", px: "61 / fluido", sample: "Preço e chance", className: "text-mega u-display" },
  { token: "text-display", px: "49 / fluido", sample: "Preço e chance", className: "text-display u-display" },
  { token: "text-h1", px: "39", sample: "Mesa de operações", className: "text-h1 u-title" },
  { token: "text-h2", px: "31", sample: "Bilhetes decididos", className: "text-h2 u-title" },
  { token: "text-h3", px: "25", sample: "Banca e resultado", className: "text-h3 u-title" },
  { token: "text-lead", px: "20", sample: "A chance que o preço carrega, medida e impressa ao lado dele.", className: "text-lead" },
  { token: "text-body", px: "16", sample: "Texto de marketing e páginas legais, com medida máxima de 65 caracteres.", className: "text-body" },
  { token: "text-base", px: "14", sample: "Texto do aplicativo dentro de painéis e formulários.", className: "text-base" },
  { token: "text-sm", px: "13", sample: "Texto padrão da interface: navegação, rótulos, botões.", className: "text-sm" },
  { token: "text-tiny", px: "12", sample: "Célula de tabela densa, legenda, aviso legal.", className: "text-tiny" },
  { token: "text-label", px: "11", sample: "CABEÇALHO DE COLUNA", className: "text-label u-label" },
  { token: "text-micro", px: "10", sample: "MARCA DE EIXO", className: "text-micro u-label" },
];

function TypeScale() {
  return (
    <div className="border border-line bg-surface-1">
      {TYPE_STEPS.map((step) => (
        <div key={step.token} className="grid grid-cols-12 items-baseline gap-4 border-b border-line px-4 py-3 last:border-b-0">
          <code className="col-span-6 text-tiny text-fg-dim md:col-span-2">{step.token}</code>
          <span className="col-span-6 nums text-tiny text-fg-dim md:col-span-1">{step.px}</span>
          <span className={`col-span-12 min-w-0 truncate text-fg md:col-span-9 ${step.className}`}>{step.sample}</span>
        </div>
      ))}
    </div>
  );
}

const SURFACES = [
  { token: "surface-0", role: "página", className: "bg-surface-0" },
  { token: "surface-1", role: "painel", className: "bg-surface-1" },
  { token: "surface-2", role: "linha em hover", className: "bg-surface-2" },
  { token: "surface-3", role: "campo, pressionado", className: "bg-surface-3" },
];

const INKS = [
  { token: "fg", role: "valor, título", ratio: "17,12", className: "text-fg" },
  { token: "fg-muted", role: "rótulo, texto de apoio", ratio: "9,49", className: "text-fg-muted" },
  { token: "fg-dim", role: "meta, unidade", ratio: "5,95", className: "text-fg-dim" },
  { token: "fg-faint", role: "desabilitado", ratio: "3,88", className: "text-fg-faint" },
];

const MEANINGS = [
  { token: "pos", role: "ganho liquidado, variação positiva", ratio: "10,41", className: "text-pos" },
  { token: "neg", role: "perda liquidada, variação negativa", ratio: "7,07", className: "text-neg" },
  { token: "warn", role: "cautela e jogo responsável", ratio: "10,60", className: "text-warn" },
  { token: "focus", role: "posição do teclado e seleção", ratio: "7,93", className: "text-focus" },
];

function Colour() {
  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-12 md:col-span-5">
        <div className="mb-2 text-label u-label text-fg-dim">Superfícies</div>
        <div className="border border-line">
          {SURFACES.map((s) => (
            <div key={s.token} className={`flex items-center justify-between border-b border-line px-3 py-3 last:border-b-0 ${s.className}`}>
              <code className="text-tiny text-fg">{s.token}</code>
              <span className="text-tiny text-fg-dim">{s.role}</span>
            </div>
          ))}
        </div>
        <div className="mt-4 mb-2 text-label u-label text-fg-dim">Ação (acromática)</div>
        <div className="flex items-center gap-3 border border-line bg-surface-1 p-3">
          <span className="inline-flex h-8 items-center bg-action px-3 text-sm text-action-fg">action / action-fg</span>
          <span className="nums text-tiny text-fg-dim">17,12:1</span>
        </div>
        <div className="mt-4 mb-2 text-label u-label text-fg-dim">Tintas de estado</div>
        <div className="border border-line">
          <div className="flex items-baseline justify-between bg-pos-tint px-3 py-2">
            <code className="text-tiny text-pos">pos-tint</code>
            <span className="nums text-sm text-pos">+1,88 u</span>
          </div>
          <div className="flex items-baseline justify-between bg-neg-tint px-3 py-2">
            <code className="text-tiny text-neg">neg-tint</code>
            <span className="nums text-sm text-neg">−1,00 u</span>
          </div>
          <div className="flex items-baseline justify-between bg-warn-tint px-3 py-2">
            <code className="text-tiny text-warn">warn-tint</code>
            <span className="text-sm text-warn">Jogo responsável</span>
          </div>
        </div>
      </div>
      <div className="col-span-12 md:col-span-7">
        <div className="mb-2 text-label u-label text-fg-dim">Tinta</div>
        <div className="border border-line bg-surface-1">
          {INKS.map((c) => (
            <div key={c.token} className="flex items-baseline gap-3 border-b border-line px-3 py-2 last:border-b-0">
              <code className={`w-24 shrink-0 text-tiny ${c.className}`}>{c.token}</code>
              <span className={`text-sm ${c.className}`}>Sevilha ou empate</span>
              <span className="ml-auto nums text-tiny text-fg-dim">{c.ratio}:1</span>
            </div>
          ))}
        </div>
        <div className="mt-4 mb-2 text-label u-label text-fg-dim">Significado — nenhuma outra cor existe</div>
        <div className="border border-line bg-surface-1">
          {MEANINGS.map((c) => (
            <div key={c.token} className="flex items-baseline gap-3 border-b border-line px-3 py-2 last:border-b-0">
              <code className={`w-24 shrink-0 text-tiny ${c.className}`}>{c.token}</code>
              <span className="text-sm text-fg-muted">{c.role}</span>
              <span className="ml-auto nums text-tiny text-fg-dim">{c.ratio}:1</span>
            </div>
          ))}
        </div>
        <p className="mt-3 max-w-measure text-tiny text-fg-dim">
          Contrastes medidos no tema escuro contra <code>surface-0</code>. A cor nunca carrega o significado sozinha:
          todo estado também tem palavra, sinal ou barra.
        </p>
      </div>
    </div>
  );
}

function Icons() {
  return (
    <div className="grid grid-cols-3 gap-px border border-line bg-line sm:grid-cols-6 lg:grid-cols-8">
      {ICON_NAMES.map((name) => (
        <div key={name} className="flex flex-col items-center gap-2 bg-surface-1 px-2 py-4">
          <Icon name={name} size={20} className="text-fg" />
          <code className="text-micro text-fg-dim">{name}</code>
        </div>
      ))}
    </div>
  );
}

function Controls({ onOpenDialog }: { onOpenDialog: () => void }) {
  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 flex flex-col gap-5 md:col-span-6 lg:col-span-5">
        <Spec label="primary — uma por tela">
          <Button variant="primary">Salvar bilhete</Button>
          <Button variant="primary" icon="plus">
            Adicionar perna
          </Button>
          <Button variant="primary" loading>
            Salvando
          </Button>
          <Button variant="primary" disabled>
            Indisponível
          </Button>
        </Spec>
        <Spec label="secondary">
          <Button icon="filter">Filtros</Button>
          <Button iconEnd="chevron-down">Período</Button>
          <Button loading>Buscando</Button>
          <Button disabled>Indisponível</Button>
        </Spec>
        <Spec label="ghost / ícone">
          <Button variant="ghost" icon="refresh">
            Atualizar
          </Button>
          <Button variant="ghost" disabled>
            Indisponível
          </Button>
          <IconButton icon="copy" label="Copiar identificador" />
          <IconButton icon="close" label="Fechar" />
          <Tooltip label="Rótulo com atraso de 600 ms">
            <IconButton icon="info" label="Sobre este número" />
          </Tooltip>
        </Spec>
        <Spec label="danger — destrutivo, nunca primário">
          <Button variant="danger" icon="close">
            Encerrar assinatura
          </Button>
          <Button variant="danger" disabled>
            Encerrar assinatura
          </Button>
        </Spec>
        <Spec label="sobreposições">
          <Button onClick={onOpenDialog}>Abrir diálogo</Button>
        </Spec>
      </div>
      <div className="col-span-12 flex flex-col gap-5 md:col-span-6 lg:col-span-4">
        <Spec label="badge — todo tom carrega uma palavra">
          <Badge>neutro</Badge>
          <Badge tone="pos">ganhou</Badge>
          <Badge tone="neg">perdeu</Badge>
          <Badge tone="warn">cautela</Badge>
          <Badge tone="info">filtro ativo</Badge>
        </Spec>
        <Spec label="status de fonte">
          <StatusBadge status="ok" />
          <StatusBadge status="pending" />
          <StatusBadge status="needs-login" />
          <StatusBadge status="error" />
          <StatusBadge status="empty" />
        </Spec>
        <Spec label="chips de mercado — seleção é acromática">
          <Chip selected>Gols</Chip>
          <Chip>Escanteios</Chip>
          <Chip>Cartões</Chip>
          <Chip>Handicap</Chip>
          <Chip tone="warn">Sem linha</Chip>
        </Spec>
        <Spec label="ao vivo — o único laço do sistema">
          <span className="inline-flex items-center gap-2 text-sm text-fg-muted">
            <span className="live-dot inline-block size-1.5 rounded-full bg-pos" />
            2º tempo · 67&apos;
          </span>
        </Spec>
      </div>
      <div className="col-span-12 flex flex-col gap-5 lg:col-span-3">
        <Spec label="raio — quadrado por padrão">
          <div className="flex w-full flex-col gap-2">
            <span className="flex h-9 items-center border border-line bg-surface-2 px-3 text-tiny text-fg-muted">0 — tabela, linha, faixa</span>
            <span className="flex h-9 items-center rounded-control border border-line bg-surface-2 px-3 text-tiny text-fg-muted">2 — controle, chip</span>
            <span className="flex h-9 items-center rounded-panel border border-line bg-surface-2 px-3 text-tiny text-fg-muted">4 — painel, diálogo</span>
          </div>
        </Spec>
        <Spec label="profundidade — duas sombras no sistema inteiro">
          <div className="flex w-full flex-col gap-2">
            <span className="flex h-9 items-center rounded-panel border border-line bg-surface-1 px-3 text-tiny text-fg-muted shadow-pop">popover</span>
            <span className="flex h-9 items-center rounded-panel border border-line bg-surface-1 px-3 text-tiny text-fg-muted shadow-dialog">diálogo</span>
          </div>
        </Spec>
        <Spec label="anel de foco — uma definição">
          <span className="inline-flex h-9 items-center rounded-control border border-line-control px-3 text-sm text-fg outline-2 outline-offset-2 outline-focus">
            Botão com foco
          </span>
        </Spec>
      </div>
    </div>
  );
}

function Fields() {
  const [range, setRange] = useState(35);
  const [checked, setChecked] = useState(true);
  const [pick, setPick] = useState("casa");
  return (
    <div className="grid grid-cols-12 gap-6">
      <div className="col-span-12 flex flex-col gap-4 md:col-span-4">
        <Field label="E-mail" htmlFor="g-email" help="Usamos apenas para o recibo." required>
          <Input id="g-email" type="email" placeholder="voce@exemplo.com.br" />
        </Field>
        <Field label="Stake" htmlFor="g-stake" help="Percentual da banca por bilhete.">
          <Input id="g-stake" numeric suffix="u" defaultValue="1,50" />
        </Field>
        <Field label="Casa" htmlFor="g-book">
          <Select id="g-book" defaultValue="bet365">
            <option value="bet365">Bet365</option>
            <option value="betano">Betano</option>
            <option value="superbet">Superbet</option>
          </Select>
        </Field>
      </div>
      <div className="col-span-12 flex flex-col gap-4 md:col-span-4">
        <Field label="Cupom" htmlFor="g-invalid" error="Cupom expirado em 12/09/2026.">
          <Input id="g-invalid" invalid defaultValue="MESA-2026" />
        </Field>
        <Field label="Identificador" htmlFor="g-readonly" help="Somente leitura.">
          <Input id="g-readonly" readOnly defaultValue="bm_7f3a19c4" className="nums" />
        </Field>
        <Field label="Plano" htmlFor="g-disabled" help="Trocar de plano exige assinatura ativa.">
          <Select id="g-disabled" disabled defaultValue="mesa">
            <option value="mesa">Mesa</option>
          </Select>
        </Field>
        <Field label="Observação" htmlFor="g-note">
          <Textarea id="g-note" placeholder="O que você viu antes de entrar nessa linha?" />
        </Field>
      </div>
      <div className="col-span-12 flex flex-col gap-5 md:col-span-4">
        <RangeField label="Chance mínima" value={range} onValueChange={setRange} min={0} max={100} format={(v) => formatPercent(v / 100, "pt", { digits: 0 })} />
        <RangeField label="Desabilitado" value={20} onValueChange={() => {}} min={0} max={100} disabled format={(v) => `${v}`} />
        <Spec label="marcação">
          <div className="flex flex-col gap-2">
            <Checkbox label="Apenas jogos com linha publicada" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
            <Checkbox label="Indisponível neste plano" disabled />
            <Radio name="g-side" label="Casa" checked={pick === "casa"} onChange={() => setPick("casa")} />
            <Radio name="g-side" label="Visitante" checked={pick === "fora"} onChange={() => setPick("fora")} />
          </div>
        </Spec>
      </div>
    </div>
  );
}

const ROWS = [
  { time: "16:00", game: "SEV × VAL", market: "Mais de 2,5 gols", price: 2.1, measured: 0.512, result: 0, state: "aberto" as const },
  { time: "16:00", game: "SEV × VAL", market: "Sevilha ou empate", price: 1.26, measured: 0.83, result: 0, state: "aberto" as const },
  { time: "18:30", game: "PAL × FLA", market: "Menos de 9,5 escanteios", price: 1.94, measured: 0.558, result: 1.88, state: "ganhou" as const },
  { time: "18:30", game: "PAL × FLA", market: "Ambas marcam", price: 2.45, measured: 0.372, result: -1, state: "perdeu" as const },
  { time: "21:00", game: "MIA × BOS", market: "Handicap +6,5", price: 21, measured: 0.008, result: 0, state: "aberto" as const },
];

const CHANCE_RAMP = [
  { step: 1 as const, label: "≥ 50 %" },
  { step: 2 as const, label: "20–50 %" },
  { step: 3 as const, label: "5–20 %" },
  { step: 4 as const, label: "1–5 %" },
  { step: 5 as const, label: "< 1 %" },
];

/** The ramp, printed: five steps, each painting a leading rule and never the number itself. */
function ChanceRamp() {
  return (
    <div className="border border-line bg-surface-1">
      <div className="border-b border-line px-3 py-2 text-label u-label text-fg-dim">Rampa de chance — a única escala sequencial</div>
      {CHANCE_RAMP.map((item) => (
        <div key={item.step} className="flex items-baseline gap-3 border-b border-line px-3 py-2 last:border-b-0" data-chance={item.step}>
          <span className="nums text-sm text-fg">{item.label}</span>
          <code className="ml-auto text-tiny text-fg-dim">chance-{item.step}</code>
        </div>
      ))}
    </div>
  );
}

function SlateTable({ density }: { density: "compact" | "default" | "comfortable" }) {
  return (
    <div data-density={density}>
      <Panel title={`densidade ${density}`} meta={`linha ${density === "compact" ? "28" : density === "default" ? "32" : "40"} px`} flush>
        <Table caption="Exemplo de grade: jogos, mercados, preço e chance">
          <thead>
            <tr>
              <Th>Hora</Th>
              <Th>Jogo</Th>
              <Th>Mercado</Th>
              <Th numeric>Preço</Th>
              <Th numeric>Chance medida</Th>
              <Th numeric>Resultado</Th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row, i) => (
              <Tr
                key={`${row.game}-${row.market}`}
                tone={row.state === "ganhou" ? "pos" : row.state === "perdeu" ? "neg" : undefined}
                selected={i === 1}
              >
                <Td label="Hora" className="nums text-fg-dim">{row.time}</Td>
                <Td label="Jogo" className="nums whitespace-nowrap">{row.game}</Td>
                <Td label="Mercado" className="text-fg-muted">{row.market}</Td>
                <Td label="Preço e implícita" numeric>
                  <Odds decimal={row.price} />
                </Td>
                <NumCell label="Chance medida" chance={chanceStep(row.measured)}>{formatPercent(row.measured, "pt")}</NumCell>
                <NumCell label="Resultado" tone={row.result > 0 ? "pos" : row.result < 0 ? "neg" : undefined}>
                  {row.result === 0 ? "—" : formatUnits(row.result, "pt")}
                </NumCell>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Panel>
    </div>
  );
}

function DataDisplay() {
  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-8">
          <SlateTable density="compact" />
          <div className="mt-4 grid grid-cols-12 gap-4">
            <p className="col-span-12 max-w-measure text-tiny text-fg-dim md:col-span-7">
              Regras em vez de zebra: um filete por linha, dois sob o cabeçalho. A linha liquidada carrega o resultado
              como barra de entrada; a selecionada, a cor do teclado. A rampa de chance pinta a borda da célula — nunca
              o número, que continua legível. O preço imprime a chance que ele embute; a coluna seguinte imprime a
              medida, e é a diferença entre as duas que sustenta a decisão.
            </p>
            <div className="col-span-12 md:col-span-5">
              <ChanceRamp />
            </div>
          </div>
        </div>
        <div className="col-span-12 flex flex-col gap-6 xl:col-span-4">
          <Panel title="Banca" meta="94 bilhetes decididos">
            <div className="grid grid-cols-2 gap-x-6 gap-y-5">
              <KPI label="Resultado" value={formatUnits(2.4, "pt")} tone="pos" sub="desde 01/08" />
              <KPI label="ROI" value={formatPercent(0.031, "pt", { signed: true })} sub="amostra: 94" />
              <KPI label="Banca" value={formatMoney(1284.5, "pt")} sub="stake médio 1,2 u" />
              <KPI label="Drawdown" value={formatUnits(-4.1, "pt")} tone="neg" sub="máximo em 12/09" />
            </div>
          </Panel>
          <Panel title="Preço e chance">
            <KeyValue
              rows={[
                { label: "Sevilha ou empate", value: "1,26", hint: "83,0 %" },
                { label: "Mais de 2,5 gols", value: "2,10", hint: "51,2 %" },
                { label: "Handicap +6,5", value: "21,00", hint: "0,8 %" },
                { label: "Escanteios asiáticos", value: "—", hint: "sem linha" },
              ]}
            />
          </Panel>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 md:col-span-6 xl:col-span-3">
          <Panel title="Carregando" flush>
            <Table caption="Exemplo de esqueleto de carregamento">
              <thead>
                <tr>
                  <Th>Jogo</Th>
                  <Th numeric>Preço</Th>
                </tr>
              </thead>
              <TableSkeleton rows={4} columns={[{ width: "70%" }, { width: "40%", numeric: true }]} />
            </Table>
          </Panel>
        </div>
        <div className="col-span-12 md:col-span-6 xl:col-span-3">
          <Panel title="Vazio">
            <Empty action={<Button icon="calendar">Abrir um jogo</Button>}>Nada na banca ainda.</Empty>
          </Panel>
        </div>
        <div className="col-span-12 md:col-span-6 xl:col-span-3">
          <Panel title="Filtrado até sobrar nada">
            <Empty action={<Button icon="close">Limpar filtros</Button>}>
              Nenhum jogo com chance acima de 60 % nesta data.
            </Empty>
          </Panel>
        </div>
        <div className="col-span-12 md:col-span-6 xl:col-span-3">
          <Panel title="Erro">
            <ErrorState
              title="Não foi possível carregar os jogos."
              detail="A fonte respondeu fora do prazo. Os bilhetes já salvos continuam acessíveis."
              code="SLATE_TIMEOUT"
              action={<Button icon="refresh">Tentar de novo</Button>}
            />
          </Panel>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 xl:col-span-6">
          <SlateTable density="default" />
        </div>
        <div className="col-span-12 xl:col-span-6">
          <SlateTable density="comfortable" />
        </div>
      </div>
    </div>
  );
}

const INDEX = [
  { id: "tipografia", n: "01", label: "Tipografia" },
  { id: "cor", n: "02", label: "Cor" },
  { id: "icones", n: "03", label: "Ícones" },
  { id: "controles", n: "04", label: "Controles" },
  { id: "campos", n: "05", label: "Campos" },
  { id: "dados", n: "06", label: "Dados e estados" },
  { id: "navegacao", n: "07", label: "Navegação" },
];

export function DesignGallery() {
  const [dialogOpen, setDialogOpen] = useState(false);
  return (
    <div className="min-h-dvh bg-surface-0 text-fg">
      <a href="#conteudo" className="sr-only focus:not-sr-only focus:absolute focus:m-2 focus:bg-action focus:px-3 focus:py-2 focus:text-action-fg">
        Pular para o conteúdo
      </a>

      <header className="sticky top-0 z-20 border-b border-line bg-surface-0">
        <div className="mx-auto flex min-h-12 max-w-shell flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2">
          <span className="u-title text-sm text-fg">
            Betmatic <span className="text-fg-dim">· sistema</span>
          </span>
          <span className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2" data-density="default">
            <span className="hidden sm:flex">
              <DensitySwitch />
            </span>
            <ThemeSwitch />
          </span>
        </div>
      </header>

      <main id="conteudo" className="mx-auto max-w-shell px-4 pb-16" data-density="default">
        <div className="grid grid-cols-12 gap-6 pt-10 pb-8">
          <div className="col-span-12 lg:col-span-7">
            <p className="text-label u-label text-fg-dim">Mesa de operações</p>
            <h1 className="mt-3 text-h1 u-title text-fg">Um instrumento, não um site de palpites</h1>
            <p className="mt-4 max-w-measure text-body text-fg-muted">
              A tela põe preço, chance medida e a evidência lado a lado para que uma decisão caiba em dois segundos e
              a centésima decisão custe o mesmo que a primeira. Por isso o tipo e o alinhamento carregam a hierarquia,
              e a cor é gasta só onde significa alguma coisa.
            </p>
          </div>
          <dl className="col-span-12 grid grid-cols-2 gap-x-6 gap-y-5 self-end lg:col-span-4 lg:col-start-9">
            <div>
              <dt className="text-label u-label text-fg-dim">Famílias</dt>
              <dd className="mt-1 text-sm text-fg">Archivo · IBM Plex Sans · IBM Plex Mono</dd>
            </div>
            <div>
              <dt className="text-label u-label text-fg-dim">Fontes no 1º paint</dt>
              <dd className="mt-1 nums text-sm text-fg">217 KB</dd>
            </div>
            <div>
              <dt className="text-label u-label text-fg-dim">Densidades</dt>
              <dd className="mt-1 text-sm text-fg">compacta · padrão · ampla</dd>
            </div>
            <div>
              <dt className="text-label u-label text-fg-dim">Temas</dt>
              <dd className="mt-1 text-sm text-fg">escuro e claro, ambos medidos</dd>
            </div>
          </dl>
        </div>

        <nav aria-label="Seções" className="mb-10 flex flex-wrap gap-x-5 gap-y-2 border-y border-line py-3">
          {INDEX.map((item) => (
            <a key={item.id} href={`#${item.id}`} className="flex items-baseline gap-2 text-sm text-fg-muted hover:text-fg">
              <span className="nums text-micro text-fg-dim">{item.n}</span>
              {item.label}
            </a>
          ))}
        </nav>

        <Section
          id="tipografia"
          n="01"
          title="Tipografia"
          note="Abaixo de 16 px os degraus são escolhidos à mão; acima, razão 1,25. Só display e mega são fluidos — uma célula que muda de tamanho com a janela não pode ser comparada entre capturas. Archivo usa o eixo de largura: 82 no cabeçalho de coluna, 112 no herói."
        >
          <TypeScale />
        </Section>

        <Section
          id="cor"
          n="02"
          title="Cor"
          note="Uma cor de ação acromática, e matiz só para estado. Verde é ganho liquidado, vermelho é perda, âmbar é cautela, azul é onde está o teclado. A marca não tem matiz: marca verde em produto de aposta sugere lucro, e a regra publicitária brasileira proíbe."
        >
          <Colour />
        </Section>

        <Section
          id="icones"
          n="03"
          title="Ícones"
          note="Um sprite local desenhado à mão: grade 20, traço 1,5, pontas redondas, currentColor. Sem pacote de ícones e sem emoji — a troca de idioma diz PT / EN, não bandeirinhas."
        >
          <Icons />
        </Section>

        <Section
          id="controles"
          n="04"
          title="Controles"
          note="Cada variante com repouso, foco, pressionado, desabilitado e carregando. O botão não muda de largura enquanto trabalha: o giro ocupa a vaga do ícone."
        >
          <Controls onOpenDialog={() => setDialogOpen(true)} />
        </Section>

        <Section
          id="campos"
          n="05"
          title="Campos"
          note="Rótulo acima, ajuda abaixo, erro com aria-describedby. Nenhum controle nativo pintado pela plataforma sobrevive: o seletor tem a nossa seta, o intervalo tem trilho e polegar próprios nos dois motores."
        >
          <Fields />
        </Section>

        <Section
          id="dados"
          n="06"
          title="Dados e estados"
          note="Tudo o que uma região de dados precisa entregar: carregando no formato final, vazio com a moldura desenhada, filtrado até sobrar nada, e erro com o que fazer em seguida."
        >
          <DataDisplay />
        </Section>

        <Section
          id="navegacao"
          n="07"
          title="Navegação e sobreposições"
          note="Abas dirigíveis pelo teclado (setas, Home, End) e diálogo nativo, que já prende o foco, fecha no Esc e devolve o foco a quem o abriu."
        >
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-12 lg:col-span-7">
              <Tabs
                tabs={[
                  { id: "linhas", label: "Linhas", panel: <SlateTable density="compact" /> },
                  {
                    id: "evidencia",
                    label: "Evidência",
                    panel: (
                      <Panel title="Por que esta linha">
                        <p className="max-w-measure-app text-sm text-fg-muted">
                          Sevilha soma 1,42 gol esperado em casa nos últimos seis jogos, contra 0,93 sofrido pelo
                          Valencia fora. O preço embute 47,6 % e a medição fica em 51,2 %.
                        </p>
                      </Panel>
                    ),
                  },
                  { id: "vazio", label: "Sem dados", panel: <Panel title="Sem dados"><Empty>Nenhuma evidência publicada para este mercado.</Empty></Panel> },
                ]}
              />
            </div>
            <div className="col-span-12 lg:col-span-5">
              <Panel title="Esqueleto de valor">
                <div className="flex flex-col gap-3">
                  <Skeleton width="60%" />
                  <Skeleton width="85%" />
                  <Skeleton width="40%" />
                </div>
              </Panel>
            </div>
          </div>
        </Section>

        <footer className="border-t border-line pt-6">
          <p className="max-w-measure-legal text-tiny text-warn">
            Proibido para menores de 18 anos. Apostas envolvem risco de perda financeira; nenhum resultado passado
            garante resultado futuro. Se o jogo deixou de ser diversão, procure ajuda.
          </p>
          <p className="mt-2 max-w-measure-legal text-tiny text-fg-dim">
            Página interna de referência do sistema. Números exibidos aqui são exemplos de formatação, não recomendações.
          </p>
        </footer>
      </main>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Confirmar bilhete"
        footer={
          <>
            <Button onClick={() => setDialogOpen(false)}>Cancelar</Button>
            <Button variant="primary" onClick={() => setDialogOpen(false)}>
              Registrar 1,50 u
            </Button>
          </>
        }
      >
        <p className="max-w-measure-app">
          Sevilha ou empate a 1,26 — 83,0 % de chance implícita. O registro entra na banca e passa a contar no
          histórico, inclusive se perder.
        </p>
      </Dialog>
    </div>
  );
}
