export interface ReserveDetails {
  id: string; symbol: string; name: string; supplied: number; borrowed: number;
  supplyApr: number; borrowApr: number; supplyApy: number; borrowApy: number;
  utilization: number; supplyCap: number; collateralFactor: number; liabilityFactor: number;
  maxUtilization: number; targetUtilization: number; enabled: boolean;
  backstopRate: number; backstop: string; poolId: string; oracleId: string;
  oraclePrice: number | null; ledger: number; fetchedAt: string;
  rateCurve: { utilization: number; apr: number }[];
}
