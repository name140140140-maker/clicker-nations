/* Адреси даних карти. Для клієнта використовується спрощена топологія (scripts/simplify-topology.mjs, допуск 0.02°):
   у ~2 рази менша за обсягом передачі й швидше парситься на слабких Android. Повний world-topology.json лишається
   у репозиторії як джерело для скриптів і не завантажується грою. */
export const TOPOLOGY_URL = "/data/world-topology-lite.json";
