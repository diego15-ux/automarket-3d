/**
 * Datos de las cuentas y autos de prueba (los usa seed-prueba.ts). Todo es de prueba:
 * correos @automarket.test, empresas y autos inventados, precios en USD.
 */
import type { Prisma } from '../src/generated/prisma/client.js';
import type { PlanCode } from '../src/generated/prisma/enums.js';

export type Account = {
  email: string;
  name: string;
  phone: string;
  country: string;
  city: string;
  planCode: PlanCode;
  bio?: string;
  dealer?: { businessName: string; taxId: string; fiscalAddress: string; businessPhone: string };
};

export const ACCOUNTS: Account[] = [
  // ── Concesionarios (identidad y RIF/ID fiscal verificados) ──
  {
    email: 'agencia.valencia@automarket.test',
    name: 'Daniela Hernández',
    phone: '+58 414 410 2201',
    country: 'VE',
    city: 'Valencia',
    planCode: 'DEALER_PRO',
    bio: 'Autos usados revisados y con papeles al día. Te atendemos con cita en nuestro local de la Av. Bolívar Norte.',
    dealer: { businessName: 'Autos Carabobo Premium C.A.', taxId: 'J-50000101-3', fiscalAddress: 'Av. Bolívar Norte, Torre Banaven, PB, Valencia, Carabobo', businessPhone: '+58 241 820 1100' },
  },
  {
    email: 'agencia.caracas@automarket.test',
    name: 'Ricardo Salazar',
    phone: '+58 412 330 5512',
    country: 'VE',
    city: 'Caracas',
    planCode: 'DEALER_BASIC',
    bio: 'Concesionario en Los Palos Grandes. Recibimos tu auto como parte de pago.',
    dealer: { businessName: 'Motores del Ávila C.A.', taxId: 'J-50000102-1', fiscalAddress: '3ra Av. de Los Palos Grandes, Edif. Ávila, Local 2, Caracas', businessPhone: '+58 212 285 4400' },
  },
  {
    email: 'agencia.bogota@automarket.test',
    name: 'Camilo Restrepo',
    phone: '+57 310 555 2040',
    country: 'CO',
    city: 'Bogotá',
    planCode: 'DEALER_PRO',
    bio: 'Vehículos con peritaje y traspaso incluido. Sede en la Autopista Norte.',
    dealer: { businessName: 'Autos Andinos S.A.S.', taxId: '901234567-8', fiscalAddress: 'Autopista Norte # 122-45, Bogotá D.C.', businessPhone: '+57 601 744 2200' },
  },
  {
    email: 'agencia.cdmx@automarket.test',
    name: 'Mariana Ortega',
    phone: '+52 55 5512 3388',
    country: 'MX',
    city: 'Ciudad de México',
    planCode: 'DEALER_BASIC',
    bio: 'Seminuevos con factura y verificación vigente. Agenda tu prueba de manejo.',
    dealer: { businessName: 'Autos Reforma S.A. de C.V.', taxId: 'ARE190521QK7', fiscalAddress: 'Av. Paseo de la Reforma 2210, Lomas de Chapultepec, CDMX', businessPhone: '+52 55 5540 9000' },
  },
  {
    email: 'agencia.madrid@automarket.test',
    name: 'Javier Molina',
    phone: '+34 611 234 567',
    country: 'ES',
    city: 'Madrid',
    planCode: 'DEALER_PRO',
    bio: 'Coches de ocasión revisados y con garantía. Estamos en el Paseo de la Castellana.',
    dealer: { businessName: 'Motor Castellana S.L.', taxId: 'B87654321', fiscalAddress: 'Paseo de la Castellana 210, 28046 Madrid', businessPhone: '+34 913 456 780' },
  },
  {
    email: 'agencia.panama@automarket.test',
    name: 'Gabriel Castillo',
    phone: '+507 6612 3456',
    country: 'PA',
    city: 'Ciudad de Panamá',
    planCode: 'DEALER_BASIC',
    bio: 'Autos con registro al día y financiamiento con bancos aliados.',
    dealer: { businessName: 'Autos del Canal S.A.', taxId: '155701234-2-2019', fiscalAddress: 'Vía España, Edificio Canal, Planta Baja, Ciudad de Panamá', businessPhone: '+507 264 8800' },
  },
  {
    email: 'agencia.miami@automarket.test',
    name: 'Andrés Navarro',
    phone: '+1 305 555 0142',
    country: 'US',
    city: 'Miami',
    planCode: 'DEALER_PRO',
    bio: 'Used cars inspected and ready to ship. Atendemos en español.',
    dealer: { businessName: 'Sunshine Auto Group LLC', taxId: '85-1234567', fiscalAddress: '7400 NW 7th Ave, Miami, FL 33150', businessPhone: '+1 305 555 0100' },
  },
  {
    email: 'agencia.buenosaires@automarket.test',
    name: 'Martín Fernández',
    phone: '+54 9 11 5555 2030',
    country: 'AR',
    city: 'Buenos Aires',
    planCode: 'DEALER_PRO',
    bio: 'Usados seleccionados con transferencia y verificación policial incluidas.',
    dealer: { businessName: 'Autos del Plata S.A.', taxId: '30-71234567-8', fiscalAddress: 'Av. del Libertador 6800, CABA, Buenos Aires', businessPhone: '+54 11 4788 2200' },
  },
  {
    email: 'agencia.santiago@automarket.test',
    name: 'Catalina Muñoz',
    phone: '+56 9 8765 4321',
    country: 'CL',
    city: 'Santiago',
    planCode: 'DEALER_BASIC',
    bio: 'Automotora en Las Condes. Revisión técnica y permiso de circulación al día.',
    dealer: { businessName: 'Automotora Andes SpA', taxId: '76.543.210-K', fiscalAddress: 'Av. Apoquindo 4501, Las Condes, Santiago', businessPhone: '+56 2 2345 6700' },
  },
  {
    email: 'agencia.lima@automarket.test',
    name: 'Rodrigo Paredes',
    phone: '+51 998 765 432',
    country: 'PE',
    city: 'Lima',
    planCode: 'DEALER_PRO',
    bio: 'Seminuevos con historial de mantenimiento. Estamos en San Isidro.',
    dealer: { businessName: 'Lima Motors S.A.C.', taxId: '20512345678', fiscalAddress: 'Av. Javier Prado Este 1450, San Isidro, Lima', businessPhone: '+51 1 421 3300' },
  },
  {
    email: 'agencia.santodomingo@automarket.test',
    name: 'Yolanda Peña',
    phone: '+1 809 555 0177',
    country: 'DO',
    city: 'Santo Domingo',
    planCode: 'DEALER_BASIC',
    bio: 'Vehículos importados y de agencia, con traspaso y marbete al día.',
    dealer: { businessName: 'Autos Caribe SRL', taxId: '131234567', fiscalAddress: 'Av. John F. Kennedy 54, Santo Domingo', businessPhone: '+1 809 555 0100' },
  },
  {
    email: 'agencia.quito@automarket.test',
    name: 'Esteban Vásconez',
    phone: '+593 99 555 1234',
    country: 'EC',
    city: 'Quito',
    planCode: 'DEALER_BASIC',
    bio: 'Patio de autos en la Av. Eloy Alfaro. Matrícula y revisión al día.',
    dealer: { businessName: 'Quito Autos Cía. Ltda.', taxId: '1791234567001', fiscalAddress: 'Av. Eloy Alfaro N35-12, Quito', businessPhone: '+593 2 245 6600' },
  },
  {
    email: 'agencia.sanjose@automarket.test',
    name: 'Sofía Araya',
    phone: '+506 8812 3456',
    country: 'CR',
    city: 'San José',
    planCode: 'DEALER_PRO',
    bio: 'Autos con RTV y marchamo al día. Atendemos en Escazú.',
    dealer: { businessName: 'Central Autos Costa Rica S.A.', taxId: '3-101-123456', fiscalAddress: 'Escazú, Centro Corporativo Plaza Roble, San José', businessPhone: '+506 2201 5500' },
  },
  // ── Vendedores particulares (identidad verificada) ──
  { email: 'particular.maracay@automarket.test', name: 'Carlos Mendoza', phone: '+58 424 301 7788', country: 'VE', city: 'Maracay', planCode: 'FREE' },
  { email: 'particular.medellin@automarket.test', name: 'Laura Gómez', phone: '+57 315 555 8811', country: 'CO', city: 'Medellín', planCode: 'PREMIUM' },
  { email: 'particular.lima@automarket.test', name: 'Jorge Rojas', phone: '+51 987 654 321', country: 'PE', city: 'Lima', planCode: 'FREE' },
  // ── Compradores (identidad verificada: pueden reservar) ──
  { email: 'comprador.caracas@automarket.test', name: 'Andrea Silva', phone: '+58 414 220 9911', country: 'VE', city: 'Caracas', planCode: 'FREE' },
  { email: 'compradora.bogota@automarket.test', name: 'Valentina Ruiz', phone: '+57 300 555 6677', country: 'CO', city: 'Bogotá', planCode: 'FREE' },
];

/** Coordenadas del centro de cada ciudad (para «Cerca de mí»). */
export const PLACES: Record<string, [number, number]> = {
  Valencia: [10.162, -68.0077],
  Caracas: [10.4806, -66.9036],
  Maracay: [10.2469, -67.5958],
  Bogotá: [4.711, -74.0721],
  Medellín: [6.2442, -75.5812],
  'Ciudad de México': [19.4326, -99.1332],
  Madrid: [40.4168, -3.7038],
  'Ciudad de Panamá': [8.9824, -79.5199],
  Miami: [25.7617, -80.1918],
  Lima: [-12.0464, -77.0428],
  'Buenos Aires': [-34.6037, -58.3816],
  Santiago: [-33.4489, -70.6693],
  'Santo Domingo': [18.4861, -69.9312],
  Quito: [-0.1807, -78.4678],
  'San José': [9.9281, -84.0907],
};

export type Car = Omit<Prisma.VehicleUncheckedCreateInput, 'sellerId' | 'slug' | 'city' | 'country' | 'status'> & { featured?: boolean };
const usedCar = (car: Car): Car => ({ condition: 'USED', ownersCount: 1, ...car });

/** Inventario por cuenta. Precios en USD (la única moneda de la plataforma por ahora). */
export const CARS: Record<string, Car[]> = {
  'agencia.valencia@automarket.test': [
    usedCar({ make: 'Toyota', model: 'Hilux', version: '2.8 SRV 4x4', year: 2022, mileageKm: 48000, price: 41500, category: 'PICKUP', fuelType: 'DIESEL', transmission: 'AUTOMATIC', drivetrain: 'FOUR_WD', horsepower: 201, exteriorColor: 'Gris plata', doors: 4, seats: 5, featured: true }),
    usedCar({ make: 'Toyota', model: 'Corolla', version: 'XEI 2.0', year: 2021, mileageKm: 42300, price: 17900, category: 'SEDAN', fuelType: 'GASOLINE', transmission: 'CVT', drivetrain: 'FWD', horsepower: 169, exteriorColor: 'Blanco perla', doors: 4, seats: 5 }),
    usedCar({ make: 'Toyota', model: 'Fortuner', version: 'SRV 4.0 V6 4x4', year: 2020, mileageKm: 68000, price: 36500, category: 'SUV', fuelType: 'GASOLINE', transmission: 'AUTOMATIC', drivetrain: 'FOUR_WD', horsepower: 235, exteriorColor: 'Negro', doors: 5, seats: 7, ownersCount: 2 }),
    usedCar({ make: 'Ford', model: 'Explorer', version: 'Limited 4WD', year: 2019, mileageKm: 71000, price: 27900, category: 'SUV', fuelType: 'GASOLINE', transmission: 'AUTOMATIC', drivetrain: 'AWD', horsepower: 290, exteriorColor: 'Rojo vino', doors: 5, seats: 7 }),
    usedCar({ make: 'Kia', model: 'Sportage', version: 'LX 2.0', year: 2020, mileageKm: 55000, price: 19800, category: 'SUV', fuelType: 'GASOLINE', transmission: 'AUTOMATIC', drivetrain: 'FWD', horsepower: 155, exteriorColor: 'Verde oliva', doors: 5, seats: 5 }),
    usedCar({ make: 'Chevrolet', model: 'Aveo', version: 'LT 1.6', year: 2014, mileageKm: 112000, price: 5800, category: 'SEDAN', fuelType: 'GASOLINE', transmission: 'MANUAL', drivetrain: 'FWD', horsepower: 103, exteriorColor: 'Azul', doors: 4, seats: 5, ownersCount: 3 }),
  ],
  'agencia.caracas@automarket.test': [
    usedCar({ make: 'Jeep', model: 'Grand Cherokee', version: 'Laredo 3.6 4x4', year: 2017, mileageKm: 85000, price: 24900, category: 'SUV', fuelType: 'GASOLINE', transmission: 'AUTOMATIC', drivetrain: 'FOUR_WD', horsepower: 290, exteriorColor: 'Gris grafito', doors: 5, seats: 5, ownersCount: 2 }),
    usedCar({ make: 'Hyundai', model: 'Tucson', version: 'GLS 2.0', year: 2019, mileageKm: 61000, price: 18500, category: 'SUV', fuelType: 'GASOLINE', transmission: 'AUTOMATIC', drivetrain: 'FWD', horsepower: 155, exteriorColor: 'Blanco', doors: 5, seats: 5 }),
    usedCar({ make: 'Mitsubishi', model: 'Lancer', version: 'GLX 1.6', year: 2015, mileageKm: 98000, price: 8900, category: 'SEDAN', fuelType: 'GASOLINE', transmission: 'MANUAL', drivetrain: 'FWD', horsepower: 115, exteriorColor: 'Plata', doors: 4, seats: 5, ownersCount: 2 }),
    { make: 'Chery', model: 'Tiggo 4 Pro', version: 'Luxury 1.5', year: 2025, condition: 'NEW', ownersCount: 0, mileageKm: 0, price: 19990, category: 'SUV', fuelType: 'GASOLINE', transmission: 'CVT', drivetrain: 'FWD', horsepower: 145, exteriorColor: 'Rojo', doors: 5, seats: 5 },
  ],
  'agencia.bogota@automarket.test': [
    usedCar({ make: 'Mazda', model: 'CX-30', version: 'Grand Touring 2.5', year: 2022, mileageKm: 31000, price: 27800, category: 'SUV', fuelType: 'GASOLINE', transmission: 'AUTOMATIC', drivetrain: 'AWD', horsepower: 186, exteriorColor: 'Rojo cereza', doors: 5, seats: 5, featured: true }),
    usedCar({ make: 'Toyota', model: 'Prado', version: 'TX-L 3.0 Diésel', year: 2019, mileageKm: 74000, price: 52000, category: 'SUV', fuelType: 'DIESEL', transmission: 'AUTOMATIC', drivetrain: 'FOUR_WD', horsepower: 171, exteriorColor: 'Blanco', doors: 5, seats: 7 }),
    usedCar({ make: 'Renault', model: 'Duster', version: 'Intens 1.3 Turbo', year: 2021, mileageKm: 45000, price: 15900, category: 'SUV', fuelType: 'GASOLINE', transmission: 'MANUAL', drivetrain: 'FWD', horsepower: 150, exteriorColor: 'Naranja', doors: 5, seats: 5 }),
    usedCar({ make: 'Chevrolet', model: 'Onix', version: 'Premier 1.0 Turbo', year: 2023, mileageKm: 18000, price: 16400, category: 'SEDAN', fuelType: 'GASOLINE', transmission: 'AUTOMATIC', drivetrain: 'FWD', horsepower: 116, exteriorColor: 'Gris', doors: 4, seats: 5 }),
  ],
  'agencia.cdmx@automarket.test': [
    usedCar({ make: 'Nissan', model: 'Versa', version: 'Advance 1.6', year: 2022, mileageKm: 36000, price: 15200, category: 'SEDAN', fuelType: 'GASOLINE', transmission: 'CVT', drivetrain: 'FWD', horsepower: 118, exteriorColor: 'Azul marino', doors: 4, seats: 5 }),
    usedCar({ make: 'Volkswagen', model: 'Jetta', version: 'Comfortline 1.4 TSI', year: 2021, mileageKm: 42000, price: 19900, category: 'SEDAN', fuelType: 'GASOLINE', transmission: 'AUTOMATIC', drivetrain: 'FWD', horsepower: 150, exteriorColor: 'Blanco', doors: 4, seats: 5 }),
    usedCar({ make: 'Ford', model: 'Lobo', version: 'XLT 3.5 EcoBoost 4x4', year: 2020, mileageKm: 66000, price: 38900, category: 'PICKUP', fuelType: 'GASOLINE', transmission: 'AUTOMATIC', drivetrain: 'FOUR_WD', horsepower: 375, exteriorColor: 'Negro', doors: 4, seats: 5 }),
  ],
  'agencia.madrid@automarket.test': [
    usedCar({ make: 'SEAT', model: 'León', version: 'FR 1.5 TSI', year: 2021, mileageKm: 39000, price: 21500, category: 'HATCHBACK', fuelType: 'GASOLINE', transmission: 'MANUAL', drivetrain: 'FWD', horsepower: 150, exteriorColor: 'Gris magnético', doors: 5, seats: 5 }),
    usedCar({ make: 'Volkswagen', model: 'Golf', version: 'GTI 2.0 TSI', year: 2020, mileageKm: 52000, price: 28900, category: 'HATCHBACK', fuelType: 'GASOLINE', transmission: 'DUAL_CLUTCH', drivetrain: 'FWD', horsepower: 245, exteriorColor: 'Rojo tornado', doors: 5, seats: 5, featured: true }),
    usedCar({ make: 'Tesla', model: 'Model 3', version: 'Long Range AWD', year: 2022, mileageKm: 41000, price: 36900, category: 'ELECTRIC', fuelType: 'ELECTRIC', transmission: 'AUTOMATIC', drivetrain: 'AWD', horsepower: 440, batteryKwh: 75, rangeKm: 602, exteriorColor: 'Blanco', doors: 4, seats: 5 }),
    usedCar({ make: 'BMW', model: 'Serie 3', version: '320d', year: 2019, mileageKm: 88000, price: 25400, category: 'SEDAN', fuelType: 'DIESEL', transmission: 'AUTOMATIC', drivetrain: 'RWD', horsepower: 190, exteriorColor: 'Azul', doors: 4, seats: 5, ownersCount: 2 }),
  ],
  'agencia.panama@automarket.test': [
    usedCar({ make: 'Toyota', model: 'RAV4', version: 'Hybrid XLE AWD', year: 2022, mileageKm: 27000, price: 33900, category: 'SUV', fuelType: 'HYBRID', transmission: 'CVT', drivetrain: 'AWD', horsepower: 219, exteriorColor: 'Azul', doors: 5, seats: 5 }),
    usedCar({ make: 'Kia', model: 'Rio', version: 'EX 1.6', year: 2021, mileageKm: 34000, price: 13800, category: 'SEDAN', fuelType: 'GASOLINE', transmission: 'AUTOMATIC', drivetrain: 'FWD', horsepower: 120, exteriorColor: 'Gris', doors: 4, seats: 5 }),
    usedCar({ make: 'Hyundai', model: 'Creta', version: 'Limited 1.5', year: 2023, mileageKm: 12000, price: 21900, category: 'SUV', fuelType: 'GASOLINE', transmission: 'CVT', drivetrain: 'FWD', horsepower: 115, exteriorColor: 'Blanco', doors: 5, seats: 5 }),
  ],
  'agencia.miami@automarket.test': [
    usedCar({ make: 'Ford', model: 'Mustang', version: 'GT 5.0 Fastback', year: 2019, mileageKm: 38000, price: 31500, category: 'SPORTS', fuelType: 'GASOLINE', transmission: 'MANUAL', drivetrain: 'RWD', horsepower: 460, engineCc: 5000, exteriorColor: 'Negro', doors: 2, seats: 4, featured: true }),
    usedCar({ make: 'Jeep', model: 'Wrangler', version: 'Unlimited Sahara', year: 2020, mileageKm: 49000, price: 34900, category: 'SUV', fuelType: 'GASOLINE', transmission: 'AUTOMATIC', drivetrain: 'FOUR_WD', horsepower: 285, exteriorColor: 'Verde', doors: 4, seats: 5 }),
    usedCar({ make: 'Chevrolet', model: 'Silverado 1500', version: 'LT 5.3 V8 4x4', year: 2021, mileageKm: 55000, price: 39800, category: 'PICKUP', fuelType: 'GASOLINE', transmission: 'AUTOMATIC', drivetrain: 'FOUR_WD', horsepower: 355, exteriorColor: 'Gris', doors: 4, seats: 6 }),
    usedCar({ make: 'Mazda', model: 'MX-5', version: 'Miata Club', year: 2021, mileageKm: 21000, price: 26500, category: 'CONVERTIBLE', fuelType: 'GASOLINE', transmission: 'MANUAL', drivetrain: 'RWD', horsepower: 181, exteriorColor: 'Rojo', doors: 2, seats: 2 }),
  ],
  'agencia.buenosaires@automarket.test': [
    usedCar({ make: 'Toyota', model: 'Hilux', version: 'SRX 2.8 4x4', year: 2021, mileageKm: 62000, price: 38900, category: 'PICKUP', fuelType: 'DIESEL', transmission: 'AUTOMATIC', drivetrain: 'FOUR_WD', horsepower: 204, exteriorColor: 'Blanco', doors: 4, seats: 5, featured: true }),
    usedCar({ make: 'Volkswagen', model: 'Amarok', version: 'V6 Highline 3.0', year: 2020, mileageKm: 70000, price: 36500, category: 'PICKUP', fuelType: 'DIESEL', transmission: 'AUTOMATIC', drivetrain: 'AWD', horsepower: 258, exteriorColor: 'Gris', doors: 4, seats: 5 }),
    usedCar({ make: 'Peugeot', model: '208', version: 'Feline 1.6', year: 2022, mileageKm: 28000, price: 17200, category: 'HATCHBACK', fuelType: 'GASOLINE', transmission: 'AUTOMATIC', drivetrain: 'FWD', horsepower: 115, exteriorColor: 'Azul', doors: 5, seats: 5 }),
    usedCar({ make: 'Fiat', model: 'Cronos', version: 'Drive 1.3', year: 2023, mileageKm: 15000, price: 14300, category: 'SEDAN', fuelType: 'GASOLINE', transmission: 'MANUAL', drivetrain: 'FWD', horsepower: 99, exteriorColor: 'Rojo', doors: 4, seats: 5 }),
  ],
  'agencia.santiago@automarket.test': [
    usedCar({ make: 'Suzuki', model: 'Swift', version: 'GLX 1.2', year: 2022, mileageKm: 24000, price: 12900, category: 'HATCHBACK', fuelType: 'GASOLINE', transmission: 'MANUAL', drivetrain: 'FWD', horsepower: 83, exteriorColor: 'Rojo', doors: 5, seats: 5 }),
    usedCar({ make: 'Mitsubishi', model: 'L200', version: 'Katana CRS 2.4 4x4', year: 2021, mileageKm: 58000, price: 27500, category: 'PICKUP', fuelType: 'DIESEL', transmission: 'MANUAL', drivetrain: 'FOUR_WD', horsepower: 181, exteriorColor: 'Plata', doors: 4, seats: 5 }),
    usedCar({ make: 'MG', model: 'ZS EV', version: 'Luxury', year: 2023, mileageKm: 9000, price: 26900, category: 'ELECTRIC', fuelType: 'ELECTRIC', transmission: 'AUTOMATIC', drivetrain: 'FWD', horsepower: 174, batteryKwh: 51, rangeKm: 320, exteriorColor: 'Blanco', doors: 5, seats: 5 }),
  ],
  'agencia.lima@automarket.test': [
    usedCar({ make: 'Toyota', model: 'RAV4', version: 'XLE 2.0', year: 2021, mileageKm: 41000, price: 28500, category: 'SUV', fuelType: 'GASOLINE', transmission: 'CVT', drivetrain: 'FWD', horsepower: 171, exteriorColor: 'Gris', doors: 5, seats: 5 }),
    usedCar({ make: 'Hyundai', model: 'Accent', version: 'GL 1.4', year: 2020, mileageKm: 52000, price: 11400, category: 'SEDAN', fuelType: 'GASOLINE', transmission: 'MANUAL', drivetrain: 'FWD', horsepower: 100, exteriorColor: 'Blanco', doors: 4, seats: 5 }),
    usedCar({ make: 'Kia', model: 'Sorento', version: 'EX 2.5 AWD', year: 2022, mileageKm: 33000, price: 34900, category: 'SUV', fuelType: 'GASOLINE', transmission: 'AUTOMATIC', drivetrain: 'AWD', horsepower: 191, exteriorColor: 'Negro', doors: 5, seats: 7, featured: true }),
  ],
  'agencia.santodomingo@automarket.test': [
    usedCar({ make: 'Honda', model: 'CR-V', version: 'EX 1.5 Turbo AWD', year: 2020, mileageKm: 47000, price: 25900, category: 'SUV', fuelType: 'GASOLINE', transmission: 'CVT', drivetrain: 'AWD', horsepower: 190, exteriorColor: 'Gris', doors: 5, seats: 5 }),
    usedCar({ make: 'Toyota', model: 'Corolla Cross', version: 'Hybrid XLE', year: 2023, mileageKm: 11000, price: 29800, category: 'SUV', fuelType: 'HYBRID', transmission: 'CVT', drivetrain: 'FWD', horsepower: 196, exteriorColor: 'Blanco perla', doors: 5, seats: 5 }),
    usedCar({ make: 'Hyundai', model: 'Sonata', version: 'GLS 2.4', year: 2019, mileageKm: 69000, price: 15800, category: 'SEDAN', fuelType: 'GASOLINE', transmission: 'AUTOMATIC', drivetrain: 'FWD', horsepower: 185, exteriorColor: 'Negro', doors: 4, seats: 5, ownersCount: 2 }),
  ],
  'agencia.quito@automarket.test': [
    usedCar({ make: 'Chevrolet', model: 'D-Max', version: '3.0 CRDi 4x4', year: 2021, mileageKm: 55000, price: 31500, category: 'PICKUP', fuelType: 'DIESEL', transmission: 'MANUAL', drivetrain: 'FOUR_WD', horsepower: 174, exteriorColor: 'Gris', doors: 4, seats: 5 }),
    usedCar({ make: 'Kia', model: 'Soluto', version: 'LX 1.4', year: 2023, mileageKm: 14000, price: 13900, category: 'SEDAN', fuelType: 'GASOLINE', transmission: 'MANUAL', drivetrain: 'FWD', horsepower: 94, exteriorColor: 'Plata', doors: 4, seats: 5 }),
    usedCar({ make: 'Haval', model: 'H6', version: '2.0 Turbo Supreme', year: 2022, mileageKm: 26000, price: 26900, category: 'SUV', fuelType: 'GASOLINE', transmission: 'DUAL_CLUTCH', drivetrain: 'FWD', horsepower: 201, exteriorColor: 'Azul', doors: 5, seats: 5 }),
  ],
  'agencia.sanjose@automarket.test': [
    usedCar({ make: 'Toyota', model: 'Prado', version: 'TX 2.8 Diésel', year: 2020, mileageKm: 61000, price: 54900, category: 'SUV', fuelType: 'DIESEL', transmission: 'AUTOMATIC', drivetrain: 'FOUR_WD', horsepower: 201, exteriorColor: 'Gris', doors: 5, seats: 7, featured: true }),
    usedCar({ make: 'Nissan', model: 'Kicks', version: 'Advance 1.6', year: 2022, mileageKm: 23000, price: 19500, category: 'SUV', fuelType: 'GASOLINE', transmission: 'CVT', drivetrain: 'FWD', horsepower: 118, exteriorColor: 'Naranja', doors: 5, seats: 5 }),
    { make: 'BYD', model: 'Dolphin', version: 'Comfort', year: 2025, condition: 'NEW', ownersCount: 0, mileageKm: 0, price: 27900, category: 'ELECTRIC', fuelType: 'ELECTRIC', transmission: 'AUTOMATIC', drivetrain: 'FWD', horsepower: 201, batteryKwh: 44.9, rangeKm: 340, exteriorColor: 'Rosa', doors: 5, seats: 5 },
  ],
  'particular.maracay@automarket.test': [
    usedCar({ make: 'Chevrolet', model: 'Spark', version: 'LS 1.0', year: 2012, mileageKm: 135000, price: 3900, category: 'HATCHBACK', fuelType: 'GASOLINE', transmission: 'MANUAL', drivetrain: 'FWD', horsepower: 65, exteriorColor: 'Amarillo', doors: 5, seats: 5, ownersCount: 3 }),
  ],
  'particular.medellin@automarket.test': [
    usedCar({ make: 'Mazda', model: '3', version: 'Touring 2.0', year: 2019, mileageKm: 58000, price: 15500, category: 'SEDAN', fuelType: 'GASOLINE', transmission: 'AUTOMATIC', drivetrain: 'FWD', horsepower: 155, exteriorColor: 'Gris', doors: 4, seats: 5 }),
    usedCar({ make: 'Renault', model: 'Sandero', version: 'Life 1.6', year: 2018, mileageKm: 72000, price: 8200, category: 'HATCHBACK', fuelType: 'GASOLINE', transmission: 'MANUAL', drivetrain: 'FWD', horsepower: 105, exteriorColor: 'Blanco', doors: 5, seats: 5, ownersCount: 2 }),
  ],
  'particular.lima@automarket.test': [
    usedCar({ make: 'Toyota', model: 'Yaris', version: 'XLI 1.5', year: 2018, mileageKm: 64000, price: 10500, category: 'SEDAN', fuelType: 'GASOLINE', transmission: 'AUTOMATIC', drivetrain: 'FWD', horsepower: 107, exteriorColor: 'Plata', doors: 4, seats: 5 }),
  ],
};

/** Palabras de cada país para que la descripción suene local. */
const TIRES: Record<string, string> = { VE: 'cauchos', CO: 'llantas', MX: 'llantas', ES: 'neumáticos', PA: 'llantas', US: 'llantas', PE: 'llantas', AR: 'cubiertas', CL: 'neumáticos', DO: 'gomas', EC: 'llantas', CR: 'llantas' };

export function describe(car: Car, country: string, dealer: boolean) {
  const owners = car.condition === 'NEW' ? '0 km, con garantía de fábrica.' : car.ownersCount === 1 ? 'Único dueño.' : `${car.ownersCount} dueños.`;
  const care = car.condition === 'NEW' ? 'Listo para entregar.' : `Mantenimiento al día y ${TIRES[country] ?? 'llantas'} en buen estado.`;
  const close = dealer ? 'Puedes verlo en nuestro local con cita y revisarlo con tu mecánico.' : 'Lo puedes revisar con tu mecánico de confianza.';
  return `${owners} ${care} ${close}`;
}

export const slugOf = (car: Car, city: string, index: number) =>
  `${car.make}-${car.model}-${car.year}-${city}-${index + 1}`
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 150);
