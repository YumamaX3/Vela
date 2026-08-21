// TypeScript declarations for JavaScript modules without type information
// These allow TS to resolve .js imports in TypeScript files

declare module '@/shared/components/Card.js' {
  import { ComponentType } from 'react';
  const Card: ComponentType<any>;
  export default Card;
}

declare module '@/app/(dashboard)/dashboard/usage/components/ProviderTopology.js' {
  import { ComponentType } from 'react';
  const ProviderTopology: ComponentType<any>;
  export default ProviderTopology;
}

declare module '@/shared/components/Sparkline.js' {
  import { ComponentType } from 'react';
  interface SparklineProps {
    data: number[];
  }
  const Sparkline: ComponentType<SparklineProps>;
  export default Sparkline;
}
