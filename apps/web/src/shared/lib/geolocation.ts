export interface Coordinates {
  latitude: number;
  longitude: number;
}

export function getCurrentLocation(): Promise<Coordinates> {
  if (!window.isSecureContext) {
    return Promise.reject(new Error('El navegador solo permite ubicación por HTTPS (o localhost).'));
  }
  if (!navigator.geolocation) return Promise.reject(new Error('Este navegador no permite obtener la ubicación.'));

  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ latitude: coords.latitude, longitude: coords.longitude }),
      error => reject(new Error(
        error.code === error.PERMISSION_DENIED
          ? 'No diste permiso de ubicación. Actívalo en el navegador para buscar cerca.'
          : error.code === error.POSITION_UNAVAILABLE
            ? 'El dispositivo no pudo determinar tu ubicación.'
            : 'La ubicación tardó demasiado. Inténtalo de nuevo.',
      )),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 15_000 },
    );
  });
}
