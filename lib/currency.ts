export interface ExchangeRateResponse {
  result: string;
  base_code: string;
  rates: Record<string, number>;
}

let cachedRate: number | null = null;
let lastFetched: number = 0;
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour

export async function getUSDToBRLRate(): Promise<number> {
  const now = Date.now();
  
  if (cachedRate && (now - lastFetched < CACHE_DURATION)) {
    return cachedRate;
  }

  try {
    const response = await fetch('https://api.exchangerate-api.com/v4/latest/USD', {
      next: { revalidate: 3600 } // Next.js level cache
    });
    
    if (!response.ok) {
      throw new Error('Failed to fetch exchange rate');
    }
    
    const data = await response.json() as ExchangeRateResponse;
    const rate = data.rates['BRL'];
    
    if (rate) {
      cachedRate = rate;
      lastFetched = now;
      return rate;
    }
    
    return 5.65; // High-quality fallback
  } catch (error) {
    console.error('Error fetching real-time exchange rate:', error);
    return cachedRate || 5.65; // Use cached or fallback
  }
}
