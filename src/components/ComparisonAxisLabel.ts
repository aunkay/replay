import type {
  ISeriesApi,
  ISeriesPrimitive,
  SeriesAttachedParameter,
} from 'lightweight-charts';

/** A benchmark label needs its own text instead of the base price-scale formatter. */
export class ComparisonAxisLabel implements ISeriesPrimitive {
  private value: number | null = null;
  private label = '';
  private color = '#f5b768';
  private requestUpdate?: () => void;
  private views = [
    {
      coordinate: () =>
        this.value === null
          ? -1
          : (this.series.priceToCoordinate(this.value) ?? -1),
      text: () => this.label,
      textColor: () => '#101318',
      backColor: () => this.color,
      visible: () =>
        this.value !== null &&
        this.series.priceToCoordinate(this.value) !== null,
    },
  ];

  constructor(private series: ISeriesApi<'Line'>) {}

  attached({ requestUpdate }: SeriesAttachedParameter) {
    this.requestUpdate = requestUpdate;
  }
  detached() {
    this.requestUpdate = undefined;
  }
  priceAxisViews() {
    return this.views;
  }
  update(value: number | null, label: string, color: string) {
    this.value = value;
    this.label = label;
    this.color = color;
    this.requestUpdate?.();
  }
}
