export type RouteChangeEvent = {
  isActive: boolean;
};

export type AirplayStateEvents = {
  routeChange: (event: RouteChangeEvent) => void;
};
