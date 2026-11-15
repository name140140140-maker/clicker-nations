/* Моделі дронів: легкі дані, потрібні UI штабу без завантаження важкого DroneGame.jsx (він підвантажується лениво). */
export const DRONE_MODELS = {
  quad: { id: "quad", name: "Квадрокоптер", desc: "Маневровий, зависає й різко повертає", speed: 1 },
  shahed: { id: "shahed", name: "Шахед", desc: "Трикутне крило, швидкий, інерційний", speed: 1.3 },
  bayraktar: { id: "bayraktar", name: "Байрактар", desc: "Літак з крилами, плавний і керований", speed: 1.1 },
};
