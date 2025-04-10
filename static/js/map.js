// Map variables
let map;
let markers = {};

// Definir íconos según el tipo de máquina
const machineIcons = {
    // Íconos por defecto para cada tipo usando FontAwesome
    'default': L.divIcon({
        html: '<i class="fas fa-tractor" style="font-size: 24px; color: #28a745;"></i>',
        className: 'machine-icon',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    }),
    // Tractores
    'Tractor': L.divIcon({
        html: '<i class="fas fa-tractor" style="font-size: 24px; color: #28a745;"></i>',
        className: 'machine-icon',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    }),
    // Cosechadoras
    'Harvester': L.divIcon({
        html: '<i class="fas fa-truck-monster" style="font-size: 24px; color: #dc3545;"></i>',
        className: 'machine-icon',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    }),
    'Tracked Harvester': L.divIcon({
        html: '<i class="fas fa-truck-monster" style="font-size: 24px; color: #dc3545;"></i>',
        className: 'machine-icon',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    }),
    // Cargadores forestales
    'Forwarder': L.divIcon({
        html: '<i class="fas fa-truck-pickup" style="font-size: 24px; color: #fd7e14;"></i>',
        className: 'machine-icon',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    }),
    // Skidders
    'Skidder': L.divIcon({
        html: '<i class="fas fa-truck-container" style="font-size: 24px; color: #6f42c1;"></i>',
        className: 'machine-icon',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    }),
    // Excavadoras
    'Excavator': L.divIcon({
        html: '<i class="fas fa-truck-plow" style="font-size: 24px; color: #ffc107;"></i>',
        className: 'machine-icon',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    }),
    // Camiones
    'Truck': L.divIcon({
        html: '<i class="fas fa-truck" style="font-size: 24px; color: #17a2b8;"></i>',
        className: 'machine-icon',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    }),
    // Otros vehículos
    'Vehicle': L.divIcon({
        html: '<i class="fas fa-car" style="font-size: 24px; color: #007bff;"></i>',
        className: 'machine-icon',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    }),
    // Two-wheel Drive Tractors
    'Two-wheel Drive Tractors - 140 Hp And Above': L.divIcon({
        html: '<i class="fas fa-tractor" style="font-size: 24px; color: #28a745;"></i>',
        className: 'machine-icon',
        iconSize: [24, 24],
        iconAnchor: [12, 12]
    })
};

// Función para obtener el ícono según el tipo de máquina
function getMachineIcon(machine) {
    // Intentar conseguir el tipo desde la propiedad type (que puede ser un objeto o string)
    let machineType = '';
    
    if (machine.type) {
        if (typeof machine.type === 'object' && machine.type.name) {
            machineType = machine.type.name;
        } else if (typeof machine.type === 'string') {
            machineType = machine.type;
        }
    }
    
    // Si no hay un ícono específico para este tipo, usar el ícono predeterminado
    return machineIcons[machineType] || machineIcons['default'];
}

// Initialize the map
function initMap() {
    // Create map centered on a default location (center of USA if no data)
    map = L.map('map').setView([40.0, -95.0], 4);
    
    // Add the OpenStreetMap tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 19
    }).addTo(map);
    
    // Add a scale control
    L.control.scale().addTo(map);
}

// Add machines to the map
function addMachinesToMap(machines) {
    console.log(`Añadiendo ${machines.length} máquinas al mapa`);
    
    // Clear existing markers
    clearMapMarkers();
    
    // Bounds to fit all markers
    const bounds = L.latLngBounds();
    let validLocations = 0;
    
    // Para grandes cantidades de máquinas, mostrar solo las primeras 50 con localización
    // para evitar sobrecargar el mapa y mejorar rendimiento
    const MAX_MARKERS = 50;
    let markersAdded = 0;
    let hasLimitedMarkers = false;
    
    // Crear un grupo de marcadores para añadirlos de una vez y mejorar rendimiento
    const markerGroup = L.layerGroup();
    
    // Primero, añadir máquina seleccionada si existe
    if (selectedMachineId) {
        const selectedMachine = machines.find(m => m.id === selectedMachineId);
        if (selectedMachine && selectedMachine.location && 
            selectedMachine.location.latitude && selectedMachine.location.longitude) {
            addSingleMachineToMap(selectedMachine, bounds, markerGroup);
            validLocations++;
            markersAdded++;
        }
    }
    
    // Luego añadir el resto hasta el límite
    for (const machine of machines) {
        // Si ya tenemos la máquina seleccionada, saltarla
        if (selectedMachineId && machine.id === selectedMachineId) {
            continue;
        }
        
        if (machine.location && machine.location.latitude && machine.location.longitude) {
            // Si alcanzamos el límite, detenernos
            if (markersAdded >= MAX_MARKERS) {
                hasLimitedMarkers = true;
                break;
            }
            
            addSingleMachineToMap(machine, bounds, markerGroup);
            validLocations++;
            markersAdded++;
        }
    }
    
    // Añadir todos los marcadores al mapa de una vez para mejor rendimiento
    markerGroup.addTo(map);
    
    // Si hemos limitado los marcadores, mostrar un mensaje
    if (hasLimitedMarkers) {
        // Crear un control personalizado para mostrar un mensaje
        const limitMessage = L.control({position: 'bottomleft'});
        limitMessage.onAdd = function(map) {
            const div = L.DomUtil.create('div', 'info');
            div.innerHTML = `
                <div class="alert alert-info p-2 m-0" style="font-size: 0.8rem; opacity: 0.9;">
                    <i class="fas fa-info-circle"></i> 
                    Mostrando ${markersAdded} de ${machines.filter(m => m.location && 
                    m.location.latitude && m.location.longitude).length} ubicaciones.
                </div>`;
            return div;
        };
        limitMessage.addTo(map);
    }
    
    console.log(`Añadidos ${markersAdded} marcadores al mapa`);
}

// Función auxiliar para añadir una máquina al mapa
function addSingleMachineToMap(machine, bounds, markerGroup) {
    const position = [machine.location.latitude, machine.location.longitude];
    
    // Determinar si esta máquina está seleccionada
    const isSelected = selectedMachineId && machine.id === selectedMachineId;
    
    // Obtener el ícono personalizado según el tipo de máquina
    const icon = getMachineIcon(machine);
    
    // Si está seleccionada, añadir la clase 'selected' al icono
    if (isSelected) {
        // Modificar el HTML del icono para incluir la clase selected
        icon.options.html = icon.options.html.replace('class="', 'class="selected ');
        icon.options.className = 'machine-icon selected';
    }
    
    // Create a marker with popup and custom icon
    const marker = L.marker(position, { icon: icon })
        .bindPopup(createMachinePopupContent(machine));
        
    // Para máquinas seleccionadas, destacar el ícono
    if (isSelected) {
        // Asegurarse que esté por encima de otros marcadores
        marker.setZIndexOffset(1000);
    }
    
    // Store marker with machine ID as key
    markers[machine.id] = marker;
    
    // Add marker to the marker group (not directly to map for performance)
    marker.addTo(markerGroup);
    
    // Add click event to select machine when marker is clicked
    marker.on('click', function() {
        selectMachine(machine.id);
    });
    
    // Extend bounds to include this marker
    bounds.extend(position);
    
    // If we have valid locations, fit the map to bounds
    if (validLocations > 0) {
        map.fitBounds(bounds, {
            padding: [50, 50],
            maxZoom: 12
        });
    }
}

// Create popup content for machine marker
function createMachinePopupContent(machine) {
    const timestamp = machine.location && machine.location.timestamp ?
        new Date(machine.location.timestamp).toLocaleString() : 'Desconocido';
    
    return `
        <div class="machine-popup">
            <h6>${machine.name || 'Sin nombre'}</h6>
            <div><strong>Modelo:</strong> ${machine.model || 'Desconocido'}</div>
            <div><strong>Categoría:</strong> ${machine.category || 'Sin categoría'}</div>
            <div><strong>Última actualización:</strong> ${timestamp}</div>
            <div class="mt-2">
                <button class="btn btn-sm btn-primary" onclick="selectMachine('${machine.id}')">
                    Ver detalles
                </button>
            </div>
        </div>
    `;
}

// Clear all markers from the map
function clearMapMarkers() {
    Object.values(markers).forEach(marker => {
        map.removeLayer(marker);
    });
    markers = {};
}

// Focus map on a specific machine
function focusMapOnMachine(machineId) {
    const marker = markers[machineId];
    if (marker) {
        map.setView(marker.getLatLng(), 14);
        marker.openPopup();
    }
}
