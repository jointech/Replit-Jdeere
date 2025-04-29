// Global variables
let selectedOrganizationId = null;
let selectedMachineId = null;
let machineMarkers = {};
let allLocationData = []; // Initialize allLocationData

// Definir una versión local de clearMapMarkers en caso de que window.clearMapMarkers no esté disponible
function clearMapMarkers() {
    console.log("Usando función clearMapMarkers local");
    // Evitar llamar a window.clearMapMarkers para prevenir recursión infinita
    // Solo limpiar machineMarkers directamente
    if (machineMarkers) {
        console.log("Limpiando marcadores locales");
        for (const key in machineMarkers) {
            if (Object.hasOwnProperty.call(machineMarkers, key)) {
                const marker = machineMarkers[key];
                if (marker && marker.setMap) {
                    marker.setMap(null);
                }
            }
        }
        machineMarkers = {};
    } else {
        console.warn("No hay arreglo machineMarkers disponible");
    }
}

// Definir una versión local de addMachinesToMap
function addMachinesToMap(machines) {
    console.log("Usando función addMachinesToMap local");
    // Evitar llamar a window.addMachinesToMap para prevenir recursión infinita
    
    // Implementar una versión simplificada para mostrar las máquinas en el mapa
    try {
        console.log(`Intentando mostrar ${machines.length} máquinas en el mapa`);
        
        // Primero limpiar el mapa
        clearMapMarkers();
        
        // Verificar si el objeto window.google está disponible
        if (window.google && window.google.maps && window.map) {
            // Crear un bounds para ajustar el mapa a todos los marcadores
            const bounds = new google.maps.LatLngBounds();
            let visibleMachines = 0;
            
            // Añadir máquina por máquina
            machines.forEach(machine => {
                // Verificar que la máquina tiene ubicación
                if (machine.location && machine.location.latitude && machine.location.longitude) {
                    visibleMachines++;
                    
                    // Crear posición
                    const position = new google.maps.LatLng(
                        machine.location.latitude,
                        machine.location.longitude
                    );
                    
                    // Agregar al bounds
                    bounds.extend(position);
                    
                    // Determinar color según alertas (simplificado)
                    let pinColor = '#4CAF50'; // Verde por defecto
                    
                    // Si hay alertas para esta máquina, usar el color correspondiente
                    if (window.machineAlerts && window.machineAlerts[machine.id]) {
                        const alerts = window.machineAlerts[machine.id];
                        if (alerts.length > 0) {
                            // Buscar la alerta de mayor severidad
                            for (const alert of alerts) {
                                if (alert.severity === 'HIGH') {
                                    pinColor = '#F44336'; // Rojo para severidad alta
                                    break;
                                } else if (alert.severity === 'MEDIUM') {
                                    pinColor = '#FF9800'; // Naranja para severidad media
                                }
                            }
                        }
                    }
                    
                    // Determinar si esta máquina está seleccionada
                    const isSelected = (machine.id === selectedMachineId);
                    
                    // Crear marcador
                    const marker = new google.maps.Marker({
                        position: position,
                        map: window.map,
                        title: machine.name || 'Máquina',
                        icon: {
                            path: google.maps.SymbolPath.CIRCLE,
                            fillColor: pinColor,
                            fillOpacity: 0.9,
                            strokeWeight: isSelected ? 3 : 1,
                            strokeColor: isSelected ? '#000000' : '#FFFFFF',
                            scale: isSelected ? 10 : 8
                        },
                        zIndex: isSelected ? 1000 : 1
                    });
                    
                    // Almacenar referencia al marcador
                    machineMarkers[machine.id] = marker;
                    
                    // Añadir evento de clic
                    marker.addListener('click', function() {
                        console.log(`Clic en marcador de máquina: ${machine.id}`);
                        selectMachine(machine.id);
                    });
                }
            });
            
            // Ajustar el mapa si hay marcadores visibles
            if (visibleMachines > 0) {
                window.map.fitBounds(bounds);
                
                // Si solo hay un marcador, hacer zoom a un nivel razonable
                if (visibleMachines === 1) {
                    window.map.setZoom(14);
                }
            }
            
            console.log(`Se mostraron ${visibleMachines} máquinas en el mapa`);
        } else {
            console.error("No se encontró el objeto google.maps o el mapa no está inicializado");
        }
    } catch (error) {
        console.error("Error al mostrar máquinas en el mapa:", error);
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    console.log("Interfaz de dashboard cargada");

    // Initialize the map only if it exists
    if (typeof window.initMap === 'function') {
        window.initMap();
    } else {
        console.warn("La función initMap no está disponible todavía");
    }

    // Set up the organization selection dropdown
    setupOrganizationSelection();

    // Set up search functionality
    setupOrganizationSearch();

    // Setup theme switcher and auth panel toggler
    setupThemeSwitcher();
    setupAuthPanelToggle();
});

// Organization selection functionality
function setupOrganizationSelection() {
    console.log("Configurando selección de organizaciones");

    // Añadir manejadores a los elementos existentes
    addOrganizationClickHandlers();

    // También agregar un controlador de eventos al elemento padre para manejar delegación de eventos
    // Esto ayudará si los elementos se recrean dinámicamente
    document.getElementById('organizationList').addEventListener('click', function(e) {
        // Verificar si el elemento clicado o alguno de sus padres es un .organization-item
        const item = e.target.closest('.organization-item');
        if (item) {
            e.preventDefault();
            const orgId = item.getAttribute('data-org-id');
            const orgName = item.textContent.trim();

            console.log(`Organización seleccionada: ${orgName} (${orgId})`);

            // Update dropdown button with organization name but keep the icon
            const dropdownButton = document.getElementById('organizationDropdown');
            if (dropdownButton) {
                dropdownButton.innerHTML = `<i class="fas fa-building me-2"></i> ${orgName}`;
            } else {
                console.error("No se encontró el elemento dropdownButton");
            }

            // Save selected organization
            selectedOrganizationId = orgId;

            // Load machines for this organization
            loadMachines(orgId);

            // Cerrar menú desplegable
            const dropdown = bootstrap.Dropdown.getInstance(dropdownButton);
            if (dropdown) {
                dropdown.hide();
            }
        }
    });
}

// Configurar el buscador de organizaciones
function setupOrganizationSearch() {
    const searchInput = document.getElementById('orgSearchInput');
    if (!searchInput) {
        console.error("No se encontró el elemento de búsqueda");
        return;
    }

    // Variables para optimización
    let debounceTimer;
    const DEBOUNCE_DELAY = 300; // ms

    // Manejar el evento de entrada para filtrar la lista con debounce
    searchInput.addEventListener('input', function() {
        // Cancelar el timer anterior
        clearTimeout(debounceTimer);

        // Establecer un nuevo timer
        debounceTimer = setTimeout(() => {
            const searchTerm = this.value.toLowerCase().trim();
            const organizationItems = document.querySelectorAll('.organization-item');
            const noResultsMessage = document.getElementById('noResultsMessage');
            let matchCount = 0;

            // Recorrer cada elemento y mostrar/ocultar según el término de búsqueda
            organizationItems.forEach(item => {
                const orgName = item.textContent.toLowerCase();
                const orgId = item.getAttribute('data-org-id');
                const listItem = item.closest('li');

                // Verificar si el nombre o ID de la organización contiene el término de búsqueda
                if (orgName.includes(searchTerm) || (orgId && orgId.includes(searchTerm))) {
                    if (listItem) {
                        listItem.style.display = '';
                        matchCount++;
                    }
                } else {
                    if (listItem) {
                        listItem.style.display = 'none';
                    }
                }
            });

            // Mostrar/ocultar mensaje de "sin resultados"
            if (noResultsMessage) {
                noResultsMessage.classList.toggle('d-none', !(matchCount === 0 && searchTerm.length > 0));
            }
        }, DEBOUNCE_DELAY);
    });

    // Prevenir que el dropdown se cierre al hacer clic en el campo de búsqueda
    searchInput.addEventListener('click', function(e) {
        e.stopPropagation();
    });

    // Al abrir el dropdown, enfocar automáticamente el campo de búsqueda
    const dropdownButton = document.getElementById('organizationDropdown');
    if (dropdownButton) {
        dropdownButton.addEventListener('shown.bs.dropdown', function() {
            searchInput.focus();
        });

        // Limpiar la búsqueda cuando se cierra el dropdown
        dropdownButton.addEventListener('hidden.bs.dropdown', function() {
            searchInput.value = '';
            // Restaurar la visibilidad de todos los elementos
            const event = new Event('input');
            searchInput.dispatchEvent(event);
        });
    }
}

// Función auxiliar para añadir manejadores de clic a elementos de organización
function addOrganizationClickHandlers() {
    const organizationItems = document.querySelectorAll('.organization-item');
    console.log(`Encontrados ${organizationItems.length} elementos de organización`);

    organizationItems.forEach(item => {
        const orgId = item.getAttribute('data-org-id');
        const orgName = item.textContent.trim();
        console.log(`  - ${orgName} (${orgId})`);
    });
}

// Load machines for the selected organization
function loadMachines(organizationId) {
    console.log(`Cargando máquinas para la organización: ${organizationId}`);

    // Obtener referencias a los elementos del DOM
    const machineListContainer = document.getElementById('machineListContainer');
    const machineLoader = document.getElementById('machineLoader');
    const emptyMachineMessage = document.getElementById('emptyMachineMessage');
    const machineCountElement = document.getElementById('machineCount');

    // Verificar que los elementos existen
    if (!machineListContainer) {
        console.error("No se encontró el elemento machineListContainer");
        return;
    }

    // Clear previous machine selection
    selectedMachineId = null;

    // Show loading
    machineListContainer.innerHTML = '';

    if (machineLoader) {
        machineLoader.classList.remove('d-none');
    }

    if (emptyMachineMessage) {
        emptyMachineMessage.classList.add('d-none');
    }

    // Ocultar campo de búsqueda y mensaje de no resultados
    const machineSearchContainer = document.getElementById('machineSearchContainer');
    const noMachineResultsMessage = document.getElementById('noMachineResultsMessage');
    const machineSearchInput = document.getElementById('machineSearchInput');

    if (machineSearchContainer) {
        machineSearchContainer.classList.add('d-none');
    }

    if (noMachineResultsMessage) {
        noMachineResultsMessage.classList.add('d-none');
    }

    // Limpiar el campo de búsqueda
    if (machineSearchInput) {
        machineSearchInput.value = '';
    }

    // Clear map markers
    clearMapMarkers();

    // Reset machine details
    resetMachineDetails();

    // Crear un objeto global para almacenar las alertas por máquina
    window.machineAlerts = {};

    // Fetch machines from API
    fetch(`/api/machines/${organizationId}`, {
        credentials: 'same-origin', // Incluir cookies en la petición
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    })
        .then(response => {
            if (!response.ok) {
                throw new Error('Error al cargar máquinas');
            }
            return response.json();
        })
        .then(machines => {
            console.log(`Recibidas ${machines.length} máquinas para la organización ${organizationId}`);

            // Guardar las máquinas cargadas para usarlas en otras funciones
            window.lastLoadedMachines = machines;

            if (machineLoader) {
                machineLoader.classList.add('d-none');
            }

            if (machines.length === 0) {
                if (emptyMachineMessage) {
                    emptyMachineMessage.textContent = 'No hay máquinas disponibles para esta organización';
                    emptyMachineMessage.classList.remove('d-none');
                }

                if (machineCountElement) {
                    machineCountElement.textContent = '0';
                }
                return;
            }

            // Update machine count
            if (machineCountElement) {
                machineCountElement.textContent = machines.length;
            }

            // Mostrar campo de búsqueda si hay máquinas
            const machineSearchContainer = document.getElementById('machineSearchContainer');
            console.log("Elemento buscador de máquinas:", machineSearchContainer);

            if (machineSearchContainer) {
                console.log("Mostrando campo de búsqueda de máquinas");
                machineSearchContainer.classList.remove('d-none');

                // Configurar la búsqueda de máquinas
                setupMachineSearch(machines);
            } else {
                console.error("No se encontró el contenedor de búsqueda de máquinas (machineSearchContainer)");
            }

            // Render machines in the list
            renderMachineList(machines);

            // Cargar las alertas de todas las máquinas y luego actualizar el mapa
            loadAllMachineAlerts(machines)
                .then(() => {
                    // Add machines to map with alert colors - usando función global
                    if (window.addMachinesToMap) {
                        console.log("Usando función global addMachinesToMap");
                        window.addMachinesToMap(machines);
                    } else {
                        console.error("Función global addMachinesToMap no disponible, usando alternativa");
                        if (window.clearMapMarkers) {
                            window.clearMapMarkers();
                        } else {
                            console.error("Función clearMapMarkers no disponible globalmente");
                        }
                    }
                })
                .catch(error => {
                    console.error("Error cargando alertas de las máquinas:", error);
                    // Mostrar las máquinas en el mapa incluso si hay error con las alertas
                    if (window.addMachinesToMap) {
                        window.addMachinesToMap(machines);
                    } else {
                        console.error("Función global addMachinesToMap no disponible después de error");
                    }
                });
        })
        .catch(error => {
            console.error('Error:', error);

            if (machineLoader) {
                machineLoader.classList.add('d-none');
            }

            if (emptyMachineMessage) {
                emptyMachineMessage.textContent = 'Error al cargar máquinas: ' + error.message;
                emptyMachineMessage.classList.remove('d-none');
            }
        });
}

// Render the machine list
function renderMachineList(machines) {
    console.log(`Renderizando lista de ${machines.length} máquinas`);
    const machineListContainer = document.getElementById('machineListContainer');
    machineListContainer.innerHTML = '';

    // Create document fragment for better performance
    const fragment = document.createDocumentFragment();

    // Function to render machines
    const renderMachineItems = (machineList) => {
        machineList.forEach(machine => {
            const machineItem = document.createElement('a');
            machineItem.href = '#';
            machineItem.className = 'list-group-item list-group-item-action machine-item';
            machineItem.setAttribute('data-machine-id', machine.id);
            machineItem.setAttribute('data-category', machine.category || '');
            machineItem.setAttribute('data-model', machine.model || '');
            machineItem.setAttribute('data-name', machine.name || '');

            const hasLocation = machine.location && machine.location.latitude && machine.location.longitude;

            // Create the HTML content for the item
            machineItem.innerHTML = `
                <div class="d-flex w-100 justify-content-between">
                    <h6 class="mb-1">${machine.name || 'Sin nombre'}</h6>
                    <small>${machine.category || 'Sin categoría'}</small>
                </div>
                <small class="d-block">Modelo: ${
                    typeof machine.model === 'object' && machine.model && machine.model.name ? 
                    machine.model.name : 
                    (machine.model || 'Desconocido')
                }</small>
                <small class="d-block ${hasLocation ? 'text-success' : 'text-muted'}">
                    <i class="fas fa-${hasLocation ? 'map-marker-alt' : 'times-circle'}"></i>
                    ${hasLocation ? 'Ubicación disponible' : 'Sin ubicación'}
                </small>
            `;

            // Add click event to select this machine
            machineItem.addEventListener('click', function(e) {
                e.preventDefault();
                selectMachine(machine.id);
            });

            fragment.appendChild(machineItem);
        });
    };

    // Render all machines at once
    renderMachineItems(machines);

    // Add all elements to container
    machineListContainer.appendChild(fragment);

    // Update search if there's an active term
    const searchInput = document.getElementById('machineSearchInput');
    if (searchInput && searchInput.value.trim()) {
        const event = new Event('input');
        searchInput.dispatchEvent(event);
    }
}

// Select a machine to show details and alerts
function selectMachine(machineId) {
    console.log(`Seleccionando máquina: ${machineId}`);

    try {
        // Guardar el ID anterior de la máquina seleccionada para comparar si cambió
        const previousSelectedMachineId = selectedMachineId;

        // Quitar clases activas de todos los elementos
        document.querySelectorAll('.active-card').forEach(card => {
            card.classList.remove('active-card');
        });

        // Remove active class from all machine items in the list
        const machineItems = document.querySelectorAll('.machine-item');
        if (machineItems && machineItems.length > 0) {
            machineItems.forEach(item => {
                if (item && item.classList) {
                    item.classList.remove('active');
                    item.classList.remove('fade-in');
                }
            });
        }

        // Add active class to selected machine in the list
        const selectedItem = document.querySelector(`.machine-item[data-machine-id="${machineId}"]`);
        if (selectedItem && selectedItem.classList) {
            selectedItem.classList.add('active');
            selectedItem.classList.add('fade-in');

            // Asegurar que el elemento seleccionado es visible (scroll into view)
            selectedItem.scrollIntoView({behavior: 'smooth', block: 'nearest'});
        } else {
            console.warn(`No se encontró elemento para la máquina con ID: ${machineId}`);
        }

        // Añadir clase activa a los paneles relacionados
        document.getElementById('machineDetailCard').classList.add('active-card');

        // Save selected machine
        selectedMachineId = machineId;

        // Focus map on selected machine
        focusMapOnMachine(machineId);

        // Si tenemos máquinas cargadas y cambió la selección, actualizar el mapa
        if (previousSelectedMachineId !== selectedMachineId && window.lastLoadedMachines) {
            console.log("Actualizando marcadores del mapa con nueva selección");
            // Recargar los marcadores para reflejar la nueva selección
            if (window.addMachinesToMap) {
                window.addMachinesToMap(window.lastLoadedMachines);
            } else {
                console.error("Función global addMachinesToMap no disponible en selectMachine");
            }
        }

        // Load machine details
        loadMachineDetails(machineId);

        // Load machine alerts
        loadMachineAlerts(machineId);
    } catch (error) {
        console.error(`Error al seleccionar máquina ${machineId}:`, error);
    }
}

// Load details for the selected machine
function loadMachineDetails(machineId) {
    console.log(`Cargando detalles para máquina: ${machineId}`);

    const machineDetailEmpty = document.getElementById('machineDetailEmpty');
    const machineDetailContent = document.getElementById('machineDetailContent');

    if (!machineDetailEmpty || !machineDetailContent) {
        console.error("No se encontraron los contenedores de detalles de máquina");
        return;
    }

    // Show loading
    machineDetailEmpty.textContent = 'Cargando detalles...';
    machineDetailEmpty.classList.remove('d-none');
    machineDetailContent.classList.add('d-none');

    // Variables para almacenar datos
    let machineData = null;
    let engineHoursData = null;

    // Cargar datos de la máquina y del horómetro en paralelo
    const machineDetailsPromise = fetch(`/api/machine/${machineId}`, {
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Error al cargar detalles de la máquina');
        }
        return response.json();
    });

    const engineHoursPromise = fetch(`/api/machine/${machineId}/engine-hours`, {
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    })
    .then(response => {
        if (!response.ok) {
            console.warn('No se pudieron cargar datos del horómetro:', response.status);
            return null;
        }
        return response.json();
    })
    .catch(error => {
        console.warn('Error al cargar datos del horómetro:', error);
        return null;
    });

    // Esperar a que ambas promesas se resuelvan
    Promise.all([machineDetailsPromise, engineHoursPromise])
        .then(([machine, hoursData]) => {
            console.log("Detalles de máquina recibidos:", machine);

            if (hoursData) {
                console.log("Datos de horómetro recibidos:", hoursData);
                engineHoursData = hoursData;
            }

            // Update machine details
            const machineName = document.getElementById('machineName');
            const machineModel = document.getElementById('machineModel');
            const machineCategory = document.getElementById('machineCategory');
            const machineLatitude = document.getElementById('machineLatitude');
            const machineLongitude = document.getElementById('machineLongitude');
            const machineLocationUpdate = document.getElementById('machineLocationUpdate');

            // Actualizar elementos solo si existen
            if (machineName) machineName.textContent = machine.name || 'Sin nombre';

            // Manejar el caso donde model puede ser un objeto
            let modelText = 'Modelo desconocido';
            if (machine.model) {
                if (typeof machine.model === 'object' && machine.model.name) {
                    modelText = machine.model.name;
                } else if (typeof machine.model === 'string') {
                    modelText = machine.model;
                }
            }
            if (machineModel) machineModel.textContent = modelText;

            if (machineCategory) machineCategory.textContent = machine.category || 'Sin categoría';

            // Update location info
            if (machine.location) {
                if (machineLatitude) machineLatitude.textContent = machine.location.latitude || '-';
                if (machineLongitude) machineLongitude.textContent = machine.location.longitude || '-';

                const timestamp = machine.location.timestamp || machine.lastUpdated;
                if (machineLocationUpdate) {
                    machineLocationUpdate.textContent = timestamp ? 
                        new Date(timestamp).toLocaleString() : 'Desconocido';
                }
            } else {
                if (machineLatitude) machineLatitude.textContent = '-';
                if (machineLongitude) machineLongitude.textContent = '-';
                if (machineLocationUpdate) machineLocationUpdate.textContent = 'No disponible';
            }

            // Actualizar widget de horómetro si hay datos disponibles
            updateHourmeterWidget(engineHoursData);

            // Show content
            machineDetailEmpty.classList.add('d-none');
            machineDetailContent.classList.remove('d-none');
        })
        .catch(error => {
            console.error('Error:', error);
            if (machineDetailEmpty) {
                machineDetailEmpty.textContent = 'Error al cargar detalles: ' + error.message;
            }
        });
}

// Función para cargar las alertas de todas las máquinas de una organización
function loadAllMachineAlerts(machines) {
    console.log(`Cargando alertas para ${machines.length} máquinas...`);

    // Inicializar el objeto de alertas
    window.machineAlerts = {};

    // Crear un arreglo de promesas, una por cada máquina
    const promises = machines.map(machine => {
        if (!machine.id) return Promise.resolve(); // Omitir máquinas sin ID

        return fetch(`/api/machine/${machine.id}/alerts`, {
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        })
        .then(response => {
            if (!response.ok) {
                console.warn(`Error al cargar alertas para máquina ${machine.id}`);
                return []; // Devolver arreglo vacío en caso de error
            }
            return response.json();
        })
        .then(alerts => {
            // Guardar las alertas en el objeto global
            window.machineAlerts[machine.id] = alerts;
            return alerts;
        })
        .catch(error => {
            console.warn(`Error al procesar alertas para máquina ${machine.id}:`, error);
            window.machineAlerts[machine.id] = []; // Inicializar como arreglo vacío en caso de error
            return []; // Continuar con el proceso
        });
    });

    // Esperar a que todas las promesas se resuelvan
    return Promise.all(promises)
        .then(() => {
            console.log(`Alertas cargadas para ${Object.keys(window.machineAlerts).length} máquinas`);
            return window.machineAlerts;
        });
}

// Load alerts for the selected machine
function loadMachineAlerts(machineId) {
    console.log(`Cargando alertas para máquina: ${machineId}`);

    const alertListContainer = document.getElementById('alertListContainer');
    const emptyAlertContainer = document.getElementById('emptyAlertContainer');
    const emptyAlertMessage = document.getElementById('emptyAlertMessage');

    if (!alertListContainer || !emptyAlertContainer || !emptyAlertMessage) {
        console.error("No se encontraron los contenedores de alertas", {
            alertListContainer: !!alertListContainer,
            emptyAlertContainer: !!emptyAlertContainer,
            emptyAlertMessage: !!emptyAlertMessage
        });
        return;
    }

    // Limpiar el contenedor de alertas
    alertListContainer.innerHTML = '';

    // Mostrar el mensaje de cargando
    emptyAlertMessage.textContent = 'Cargando alertas...';
    emptyAlertContainer.classList.remove('d-none');
    alertListContainer.classList.add('d-none');

    // Fetch machine alerts from API
    // Usamos alertas reales en vez de simuladas
    fetch(`/api/machine/${machineId}/alerts`, {
        credentials: 'same-origin', // Incluir cookies en la petición
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    })
        .then(response => {
            if (!response.ok) {
                throw new Error('Error al cargar alertas');
            }
            return response.json();
        })
        .then(alerts => {
            // Actualizar el gráfico con las alertas
            updateAlertsSummaryChart(alerts);

            console.log(`Recibidas ${alerts.length} alertas para la máquina ${machineId}`);

            if (alerts.length === 0) {
                emptyAlertMessage.textContent = 'No hay alertas para esta máquina';
                emptyAlertContainer.classList.remove('d-none');
                alertListContainer.classList.add('d-none');
                return;
            }

            // Mostrar el contenedor de la lista y ocultar el mensaje vacío
            alertListContainer.classList.remove('d-none');
            emptyAlertContainer.classList.add('d-none');

            // Añadir efecto de destaque al panel de alertas
            const alertsPanel = document.querySelector('.card .card-header h5 i.fa-bell')?.closest('.card');
            if (alertsPanel) {
                alertsPanel.classList.add('active-card');
            }

            // Render alerts in the list with animation
            renderAlertList(alerts);
        })
        .catch(error => {
            console.error("Error al cargar alertas:", error.error || error.message || error);
            // Mostrar mensaje de error en la interfaz
            const alertsContainer = document.getElementById('alerts-container');
            if (alertsContainer) {
                alertsContainer.innerHTML = `
                    <div class="alert alert-danger">
                        Error al cargar las alertas. Por favor, intente nuevamente.
                    </div>
                `;
            }
        });
}

/* 
 * Nueva implementación directa para mostrar detalles de alertas
 * Esta función se llama directamente desde el HTML y no depende de eventos dinámicos
 */
function toggleAlertDetails(button, definitionUri) {
    console.log(`Procesando detalles de alerta para: ${definitionUri}`);

    // Buscar el contenedor de alertas (el div padre del botón)
    const alertContainer = button.closest('.alert-container');
    if (!alertContainer) {
        console.error("No se encontró el contenedor principal");
        return;
    }

    // Buscar el contenedor de detalles (hermano del botón)
    const detailsContainer = alertContainer.querySelector('.alert-details-container');
    if (!detailsContainer) {
        console.error("No se encontró el contenedor para mostrar detalles");
        return;
    }

    // Verificar si el botón ya estaba expandido
    const isExpanded = button.classList.contains('expanded');

    // Si ya está expandido, solo oculta el contenido
    if (isExpanded) {
        // Ocultar los detalles
        detailsContainer.classList.add('d-none');
        // Cambiar el botón de vuelta
        button.innerHTML = '<i class="fas fa-info-circle me-1"></i> Ver detalles adicionales';
        button.classList.remove('expanded');
        return;
    }

    // Si no está expandido, mostrar y llenar el contenido
    // Cambiar el botón primero para indicar que está cargando
    button.innerHTML = '<i class="fas fa-times-circle me-1"></i> Ocultar detalles';
    button.classList.add('expanded');

    // Mostrar el contenedor pero con un spinner primero
    detailsContainer.classList.remove('d-none');
    detailsContainer.innerHTML = `
        <div class="alert-details-content">
            <div class="text-center py-3">
                <div class="spinner-border text-info" role="status">
                    <span class="visually-hidden">Cargando...</span>
                </div>
                <p class="mt-2">Cargando detalles de la alerta...</p>
            </div>
        </div>
    `;

    // Extraer el ID de la alerta desde la URI
    const alertId = definitionUri.split('/').pop();

    // Construir los detalles inmediatamente con información local
    const detailsHtml = `
        <div class="alert-details-content">
            <h5 class="alert-heading">Alerta DTC ${alertId}</h5>
            <p>Esta es una alerta de código de diagnóstico (DTC) con ID ${alertId}. Para más información, consulte la documentación técnica de John Deere o contacte con su concesionario.</p>

            <hr>

            <h6>Posibles causas:</h6>
            <ul>
                <li>Esta información no está disponible actualmente a través de la API.</li>
                <li>Es posible que se necesiten permisos adicionales para acceder a esta información.</li>
            </ul>

            <h6>Soluciones recomendadas:</h6>
            <ul>
                <li>Para resolver este problema, consulte con un técnico autorizado de John Deere.</li>
                <li>Puede encontrar más información en el manual técnico del equipo.</li>
            </ul>

            <div class="mt-3 small text-muted">
                <i class="fas fa-info-circle me-1"></i>
                <em>Nota: Información generada a partir del ID de la alerta. No representa datos completos de la API de John Deere.</em>
            </div>
        </div>
    `;

    // Mostrar los detalles inmediatamente
    detailsContainer.innerHTML = detailsHtml;

    // Intentar obtener la información real de la API (para registro)
    console.log(`Enviando solicitud a API: /api/alert/definition?uri=${encodeURIComponent(definitionUri)}`);

    fetch(`/api/alert/definition?uri=${encodeURIComponent(definitionUri)}`, {
        credentials: 'same-origin',
        method: 'GET'
    })
    .then(response => response.json())
    .then(data => {
        console.log("Respuesta de la API recibida:", data);
        // No hacemos nada con la respuesta ya que ya mostramos contenido al usuario
    })
    .catch(error => {
        console.error("Error al comunicarse con la API:", error);
        // No mostramos errores ya que ya hay contenido visible
    });
}

/**
 * NUEVA FUNCIÓN: Muestra los detalles de alerta directamente en el elemento, 
 * sin usar contenedores anidados ni clases especiales
 */
function showAlertDetailsInline(button, definitionUri, alertId) {
    console.log(`Mostrando detalles para: ${definitionUri}`);

    // Extraer el ID de la alerta si no se pasó como argumento
    if (!alertId) {
        alertId = definitionUri.split('/').pop();
    }

    // Encontrar el contenedor de detalles (hermano del botón)
    const detailsContainer = button.nextElementSibling;
    if (!detailsContainer) {
        console.error("No se encontró contenedor para mostrar detalles");
        return;
    }

    // Verificar si el botón ya estaba expandido
    const isExpanded = button.classList.contains('expanded');

    // Si ya está expandido, solo oculta el contenido
    if (isExpanded) {
        detailsContainer.style.display = 'none';
        button.innerHTML = '<i class="fas fa-info-circle me-1"></i> Ver detalles adicionales';
        button.classList.remove('expanded');
        return;
    }

    // Si no está expandido, mostrar el contenido
    detailsContainer.style.display = 'block';
    button.innerHTML = '<i class="fas fa-times-circle me-1"></i> Ocultar detalles';
    button.classList.add('expanded');

    // Indicador de carga mientras esperamos datos de la API
    detailsContainer.innerHTML = `
        <div class="text-center py-3">
            <div class="spinner-border text-info" role="status">
                <span class="visually-hidden">Cargando...</span>
            </div>
            <p class="mt-2">Cargando detalles de la alerta...</p>
        </div>
    `;

    // Intentar obtener datos reales de la API
    fetch(`/api/alert/definition?uri=${encodeURIComponent(definitionUri)}`, {
        credentials: 'same-origin',
        method: 'GET'
    })
    .then(response => response.json())
    .then(data => {
        console.log("Respuesta de la API recibida:", data);

        // Procesar la respuesta de la API para mostrar datos relevantes
        let detailsHtml = '';

        if (data && data.success) {
            // Usar los datos de la API para mostrar información detallada
            detailsHtml = `
                <h5 class="text-info mb-3">${data.title || `Alerta DTC ${alertId}`}</h5>
                <p class="mb-3">${data.description || `Esta es una alerta de código de diagnóstico (DTC) con ID ${alertId}. Para más información, consulte la documentación técnica de John Deere.`}</p>

                <hr>
            `;

            // Añadir causas si están disponibles
            if (data.causes && data.causes.length > 0) {
                detailsHtml += `
                    <h6 class="text-warning mt-3">Posibles causas:</h6>
                    <ul class="mb-3">
                `;

                data.causes.forEach(cause => {
                    detailsHtml += `<li>${cause}</li>`;
                });

                detailsHtml += '</ul>';
            }

            // Añadir soluciones si están disponibles
            if (data.resolutions && data.resolutions.length > 0) {
                detailsHtml += `
                    <h6 class="text-success mt-3">Soluciones recomendadas:</h6>
                    <ul class="mb-3">
                `;

                data.resolutions.forEach(resolution => {
                    detailsHtml += `<li>${resolution}</li>`;
                });

                detailsHtml += '</ul>';
            }

            // Información adicional y nota
            if (data.additionalInfo) {
                detailsHtml += `
                    <div class="mt-3">
                        <strong>Información adicional:</strong> ${data.additionalInfo}
                    </div>
                `;
            }

            if (data.note) {
                detailsHtml += `
                    <div class="mt-3 small text-muted">
                        <i class="fas fa-info-circle me-1"></i>
                        <em>${data.note}</em>
                    </div>
                `;
            }
        } else {
            // Mostrar mensaje de error o información por defecto
            detailsHtml = `
                <h5 class="text-info mb-3">Alerta DTC ${alertId}</h5>
                <p class="mb-3">Esta es una alerta de código de diagnóstico (DTC). Para más información, consulte la documentación técnica de John Deere o contacte con su concesionario.</p>

                <hr>

                <div class="alert alert-info" role="alert">
                    <i class="fas fa-info-circle me-2"></i>
                    No se pudo obtener información detallada para esta alerta. Es posible que se requieran permisos adicionales para acceder a los detalles completos.
                </div>

                <h6 class="text-warning mt-3">Recomendaciones generales:</h6>
                <ul class="mb-3">
                    <li>Consulte con un técnico autorizado de John Deere.</li>
                    <li>Revise el manual técnico del equipo para más información.</li>
                </ul>
            `;
        }

        // Actualizar el contenedor con los detalles
        detailsContainer.innerHTML = detailsHtml;
    })
    .catch(error => {
        console.error("Error al comunicarse con la API:", error);

        // Mostrar un mensaje de error
        detailsContainer.innerHTML = `
            <div class="alert alert-danger" role="alert">
                <i class="fas fa-exclamation-triangle me-2"></i>
                No se pudo obtener información para esta alerta debido a un error de comunicación.
            </div>

            <h5 class="text-info mt-3">Alerta DTC ${alertId}</h5>
            <p>Esta es una alerta de código de diagnóstico (DTC). Para más información, consulte la documentación técnica de John Deere.</p>
        `;
    });
}

// Función antigua para compatibilidad (será llamada por los event listeners existentes)
function loadAlertDetails(button, definitionUri) {
    // Simplemente redirige a la nueva implementación
    showAlertDetailsInline(button, definitionUri);
}

// Render the alert list
function renderAlertList(alerts) {
    console.log(`Renderizando lista de ${alerts.length} alertas`);

    // También actualizar la tabla de alertas
    updateAlertsTable(alerts);

    const alertListContainer = document.getElementById('alertListContainer');
    if (!alertListContainer) {
        console.error("No se encontró el contenedor de lista de alertas");
        return;
    }

    alertListContainer.innerHTML = '';

    alerts.forEach(alert => {
        try {
            const alertItem = document.createElement('div');
            alertItem.className = 'list-group-item';

            // Determine severity class based on the John Deere severity levels
            // HIGH: rojo, MEDIUM: amarillo, LOW/DTC/UNKNOWN: gris, INFO: azul
            let severityClass = 'alert-severity-info';
            let severityBgClass = 'bg-severity-info';
            let severityIcon = 'info-circle';
            let severityText = 'Info';

            if (alert.severity) {
                const severityLower = String(alert.severity).toLowerCase();
                switch (severityLower) {
                    case 'high':
                        severityClass = 'alert-severity-high';
                        severityBgClass = 'bg-severity-high';
                        severityIcon = 'exclamation-circle';
                        severityText = 'Alto';
                        break;
                    case 'medium':
                        severityClass = 'alert-severity-medium';
                        severityBgClass = 'bg-severity-medium';
                        severityIcon = 'exclamation-triangle';
                        severityText = 'Medio';
                        break;
                    case 'low':
                        severityClass = 'alert-severity-low';
                        severityBgClass = 'bg-severity-low';
                        severityIcon = 'exclamation';
                        severityText = 'Bajo';
                        break;
                    case 'dtc':
                        severityClass = 'alert-severity-dtc';
                        severityBgClass = 'bg-severity-dtc';
                        severityIcon = 'cog';
                        severityText = 'DTC';
                        break;
                    case 'unknown':
                        severityClass = 'alert-severity-unknown';
                        severityBgClass = 'bg-severity-unknown';
                        severityIcon = 'question-circle';
                        severityText = 'Desconocido';
                        break;
                }
            }

            // Format timestamp
            let timestamp = 'Desconocido';
            if (alert.timestamp) {
                try {
                    timestamp = new Date(alert.timestamp).toLocaleString();
                } catch (e) {
                    console.warn(`Error al formatear timestamp: ${e.message}`);
                }
            }

            // Create the HTML content for the alert
            // Verificar si tiene links y extraer una posible definición
            let definitionLink = null;
            if (alert.links && Array.isArray(alert.links)) {
                console.log("Procesando enlaces para alerta:", alert.id, alert.links);
                for (const link of alert.links) {
                    if ((link.rel === 'definition' || link.rel === 'alertDefinition') && link.uri) {
                        console.log("Encontrado enlace de definición:", link.uri);
                        definitionLink = link.uri;
                        break;
                    }
                }
            }

            // Añadir más detalles de depuración para el usuario
            console.log("Contenido completo de la alerta:", alert);

            // Extraer información adicional si está disponible
            let alertContent = '';
            if (alert.content) {
                try {
                    if (typeof alert.content === 'string') {
                        alertContent = alert.content;
                    } else if (typeof alert.content === 'object') {
                        alertContent = JSON.stringify(alert.content);
                    }
                } catch (e) {}
            }

            // Crear un objeto con toda la información disponible, para mostrar al usuario
            let alertDetails = {};
            for (const [key, value] of Object.entries(alert)) {
                // Excluir propiedades específicas que ya mostramos o que son complejas
                if (!['links', 'id', 'title', 'description', 'severity', 'timestamp', 'status', 'type'].includes(key)) {
                    if (typeof value !== 'object' || value === null) {
                        alertDetails[key] = value;
                    } else if (Array.isArray(value)) {
                        alertDetails[key] = `Array con ${value.length} elementos`;
                    } else {
                        try {
                            alertDetails[key] = JSON.stringify(value);
                        } catch (e) {
                            alertDetails[key] = 'Objeto complejo';
                        }
                    }
                }
            }

            // Convertir a string para mostrar en la interfaz
            let additionalDetailsHtml = '';
            if (Object.keys(alertDetails).length > 0) {
                additionalDetailsHtml = '<dl class="row small mt-2 mb-1">';
                for (const [key, value] of Object.entries(alertDetails)) {
                    if (value !== undefined && value !== null && value !== '') {
                        additionalDetailsHtml += `
                            <dt class="col-sm-3 text-truncate">${key}</dt>
                            <dd class="col-sm-9">${value}</dd>
                        `;
                    }
                }
                additionalDetailsHtml += '</dl>';
            }

            // Incluir el contenido raw de la alerta (puede contener información importante)
            let rawContent = '';
            if (alert.raw) {
                try {
                    if (typeof alert.raw === 'string') {
                        rawContent = alert.raw;
                    } else {
                        rawContent = JSON.stringify(alert.raw);
                    }
                } catch (e) {}
            }

            // Generar el HTML mejorado
            alertItem.innerHTML = `
                <div class="d-flex w-100 justify-content-between">
                    <h6 class="mb-1 ${severityClass}">
                        <i class="fas fa-${severityIcon} me-2"></i>
                        ${alert.title || 'Alerta sin título'} 
                        <span class="badge ${severityBgClass} ms-2">${severityText}</span>
                    </h6>
                    <small class="text-muted">${alert.status || 'Estado desconocido'}</small>
                </div>
                <p class="mb-1 small">${alert.description || 'Sin descripción'}</p>

                <!-- Información técnica adicional, si está disponible -->
                ${additionalDetailsHtml}

                <div class="d-flex justify-content-between align-items-center mt-2">
                    <small class="text-muted">${timestamp}</small>
                    <small class="text-muted">Tipo: ${alert.type || 'Desconocido'}</small>
                </div>

                <!-- Eliminado botón "Ver detalles adicionales" a petición del usuario -->

                <!-- ID de alerta para referencia -->
                <div class="text-end">
                    <small class="text-muted">ID: ${alert.id || 'No disponible'}</small>
                </div>
                `;

            alertListContainer.appendChild(alertItem);
        } catch (error) {
            console.error("Error al renderizar alerta:", error);
        }
    });

    // Eliminado el manejador de eventos para los botones "Ver detalles adicionales"
}

// Configurar la búsqueda de máquinas
function setupMachineSearch(allMachines) {
    console.log("Configurando búsqueda para", allMachines.length, "máquinas");
    const searchInput = document.getElementById('machineSearchInput');
    const noResultsMessage = document.getElementById('noMachineResultsMessage');

    if (!searchInput) {
        console.error('No se encontró el elemento de búsqueda de máquinas');
        return;
    }

    // Guardar todas las máquinas para filtrarlas
    window.allMachines = allMachines;

    // Eliminar listeners anteriores para evitar duplicación
    searchInput.removeEventListener('input', handleMachineSearch);

    // Variables para optimización
    let debounceTimer;
    const DEBOUNCE_DELAY = 300; // ms

    // Manejar el evento de entrada para filtrar la lista con debounce
    searchInput.addEventListener('input', function() {
        // Cancelar el timer anterior
        clearTimeout(debounceTimer);

        // Mostrar un indicador de búsqueda en progreso
        const loadingIndicator = document.getElementById('machineSearchLoading');
        if (loadingIndicator) {
            loadingIndicator.classList.remove('d-none');
        }

        // Establecer un nuevo timer
        debounceTimer = setTimeout(() => {
            handleMachineSearch.call(this);

            // Ocultar el indicador de búsqueda
            if (loadingIndicator) {
                loadingIndicator.classList.add('d-none');
            }
        }, DEBOUNCE_DELAY);
    });

    // Función para manejar la búsqueda (definida fuera para poder eliminarla)
    function handleMachineSearch() {
        const searchTerm = this.value.toLowerCase().trim();
        const machineListContainer = document.getElementById('machineListContainer');

        console.log("Buscando máquinas con término:", searchTerm);

        // Si no hay término de búsqueda, mostrar todas las máquinas
        if (searchTerm === '') {
            // Limpiar y volver a renderizar todas las máquinas
            machineListContainer.innerHTML = '';
            renderMachineList(allMachines);
            noResultsMessage.classList.add('d-none');
            return;
        }

        // Optimización: Si hay demasiadas máquinas, usar un algoritmo de búsqueda más eficiente
        // que priorice coincidencias exactas primero
        let filteredMachines = [];

        // Prioridad 1: Coincidencias exactas en ID
        const exactIdMatches = allMachines.filter(machine => 
            machine.id.toString().toLowerCase() === searchTerm);
        filteredMachines.push(...exactIdMatches);

        // Prioridad 2: Coincidencias exactas en nombre
        if (searchTerm.length > 2) {  // Solo para términos de búsqueda significativos
            const exactNameMatches = allMachines.filter(machine => 
                !exactIdMatches.includes(machine) && 
                (machine.name || '').toLowerCase() === searchTerm);
            filteredMachines.push(...exactNameMatches);
        }

        // Prioridad 3: Coincidencias parciales
        const partialMatches = allMachines.filter(machine => {
            // Saltamos las máquinas que ya están incluidas por coincidencias exactas
            if (filteredMachines.includes(machine)) {
                return false;
            }

            const name = (machine.name || '').toLowerCase();

            // Manejar el caso donde model puede ser un objeto o una cadena
            let model = '';
            if (machine.model) {
                if (typeof machine.model === 'string') {
                    model = machine.model.toLowerCase();
                } else if (typeof machine.model === 'object' && machine.model.name) {
                    model = machine.model.name.toLowerCase();
                }
            }

            const category = (machine.category || '').toLowerCase();
            const id = machine.id.toString().toLowerCase();

            return name.includes(searchTerm) || 
                   model.includes(searchTerm) || 
                   category.includes(searchTerm) ||
                   id.includes(searchTerm);
        });

        // Añadir todas las coincidencias parciales
        filteredMachines.push(...partialMatches);

        console.log("Máquinas filtradas:", filteredMachines.length);

        // Actualizar la lista con las máquinas filtradas
        machineListContainer.innerHTML = '';

        if (filteredMachines.length > 0) {
            // Mostrar mensaje si se limitaron los resultados
            if (partialMatches.length > MAX_RESULTS) {
                const limitMessage = document.createElement('div');
                limitMessage.className = 'alert alert-info small mb-2';
                limitMessage.innerHTML = `<i class="fas fa-info-circle"></i> Mostrando ${filteredMachines.length} resultados. Refine su búsqueda para ver más máquinas.`;
                machineListContainer.appendChild(limitMessage);
            }

            renderMachineList(filteredMachines);
            noResultsMessage.classList.add('d-none');
        } else {
            noResultsMessage.classList.remove('d-none');
        }
    }
}

// Reset machine details
function resetMachineDetails() {
    console.log("Reseteando detalles de máquina");

    // Reset alerts
    const emptyAlertContainer = document.getElementById('emptyAlertContainer');
    const emptyAlertMessage = document.getElementById('emptyAlertMessage');
    const alertListContainer = document.getElementById('alertListContainer');
    const machineDetailEmpty = document.getElementById('machineDetailEmpty');
    const machineDetailContent = document.getElementById('machineDetailContent');

    if (emptyAlertMessage && emptyAlertContainer) {
        emptyAlertMessage.textContent = 'Seleccione una máquina para ver sus alertas';
        emptyAlertContainer.classList.remove('d-none');
    }

    if (alertListContainer) {
        alertListContainer.innerHTML = '';
        alertListContainer.classList.add('d-none');
    }

    // Reset machine details
    if (machineDetailEmpty) {
        machineDetailEmpty.classList.remove('d-none');
    }

    if (machineDetailContent) {
        machineDetailContent.classList.add('d-none');
    }
}

// Función para manejar el cambio de tema (removida)
function setupThemeSwitcher() {
    // Tema oscuro por defecto
    document.body.classList.remove('light-theme');
}

// Función para manejar la visibilidad del panel de autenticación
function setupAuthPanelToggle() {
    const toggleAuthBtn = document.getElementById('toggleAuthInfo');
    const authPanel = document.getElementById('authInfoPanel');

    if (!toggleAuthBtn || !authPanel) {
        console.warn('Elementos del panel de autenticación no encontrados');
        return;
    }

    toggleAuthBtn.addEventListener('click', function(e) {
        e.preventDefault();

        const isVisible = authPanel.style.display !== 'none';

        if (isVisible) {
            authPanel.style.display = 'none';
            toggleAuthBtn.textContent = 'Mostrar información de autenticación';
        } else {
            authPanel.style.display = 'block';
            toggleAuthBtn.textContent = 'Ocultar información de autenticación';
        }
    });
}

// Add a new function to update the alerts summary charts
function updateAlertsSummaryChart(alerts) {
    console.log('Updating charts with alerts:', alerts);

    // Update severity distribution chart
    const ctxSeverity = document.getElementById('alertsSeverityChart').getContext('2d');
    const ctxTimeline = document.getElementById('alertsTimelineChart').getContext('2d');

    if (ctxSeverity && ctxTimeline) {
        // Agrupar alertas por severidad
        const alertSeverities = {
            'high': 0,
            'medium': 0,
            'low': 0,
            'info': 0,
            'dtc': 0,
            'unknown': 0
        };

        // Preparar datos para el timeline
        const timelineData = {};
        const severityColors = {
            'high': 'rgb(220, 53, 69)',     // rojo
            'medium': 'rgb(255, 193, 7)',    // amarillo
            'low': 'rgb(108, 117, 125)',     // gris
            'info': 'rgb(23, 162, 184)',     // azul
            'dtc': 'rgb(111, 66, 193)',      // morado
            'unknown': 'rgb(73, 80, 87)'     // gris oscuro
        };

        // Ordenar alertas por fecha
        const sortedAlerts = [...alerts].sort((a, b) => 
            new Date(a.timestamp) - new Date(b.timestamp)
        );

        sortedAlerts.forEach(alert => {
            // Contar por severidad
            const severity = alert.severity?.toLowerCase() || 'unknown';
            alertSeverities[severity] = (alertSeverities[severity] || 0) + 1;

            // Agrupar por fecha para el timeline
            const date = new Date(alert.timestamp).toLocaleDateString();
            if (!timelineData[date]) {
                timelineData[date] = {
                    high: 0, medium: 0, low: 0, info: 0, dtc: 0, unknown: 0
                };
            }
            timelineData[date][severity]++;
        });

        // Preparar datos para el gráfico de severidad
        const severityLabels = Object.keys(alertSeverities).map(sev => {
            switch(sev) {
                case 'high': return 'Alta';
                case 'medium': return 'Media';
                case 'low': return 'Baja';
                case 'info': return 'Info';
                case 'dtc': return 'DTC';
                case 'unknown': return 'Desconocida';
                default: return sev;
            }
        });

        // Destruir gráficos anteriores si existen
        if (window.severityChart) window.severityChart.destroy();
        if (window.timelineChart) window.timelineChart.destroy();

        // Crear gráfico de distribución de severidad
        window.severityChart = new Chart(ctxSeverity, {
            type: 'bar',
            data: {
                labels: severityLabels,
                datasets: [{
                    label: 'Cantidad de Alertas',
                    data: Object.values(alertSeverities),
                    backgroundColor: Object.values(severityColors).map(color => color.replace('rgb', 'rgba').replace(')', ', 0.5)')),
                    borderColor: Object.values(severityColors),
                    borderWidth: 1
                }]
            },
            options: {
                responsive: true,
                plugins: {
                    legend: { display: false },
                    title: {
                        display: true,
                        text: 'Distribución de Alertas por Severidad',
                        color: '#fff'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { color: '#fff', stepSize: 1 },
                        grid: { color: 'rgba(255, 255, 255, 0.1)' }
                    },
                    x: {
                        ticks: { color: '#fff' },
                        grid: { color: 'rgba(255, 255, 255, 0.1)' }
                    }
                }
            }
        });

        // Crear gráfico de línea temporal
        const timelineDates = Object.keys(timelineData);
        const timelineDatasets = Object.keys(alertSeverities).map(severity => ({
            label: severity.charAt(0).toUpperCase() + severity.slice(1),
            data: timelineDates.map(date => timelineData[date][severity]),
            borderColor: severityColors[severity],
            backgroundColor: severityColors[severity].replace('rgb', 'rgba').replace(')', ', 0.1)'),
            tension: 0.1,
            fill: true
        }));

        window.timelineChart = new Chart(ctxTimeline, {
            type: 'line',
            data: {
                labels: timelineDates,
                datasets: timelineDatasets
            },
            options: {
                responsive: true,
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        labels: { color: '#fff' }
                    },
                    title: {
                        display: true,
                        text: 'Alertas a lo largo del tiempo',
                        color: '#fff'
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        stacked: true,
                        ticks: { color: '#fff' },
                        grid: { color: 'rgba(255, 255, 255, 0.1)' }
                    },
                    x: {
                        ticks: { color: '#fff' },
                        grid: { color: 'rgba(255, 255, 255, 0.1)' }
                    }
                }
            }
        });
    } else {
        console.error("One or both canvas elements not found.");
    }
}

// Función para actualizar la tabla de alertas
function updateAlertsTable(alerts) {
    const tableBody = document.getElementById('alertsTableBody');
    if (!tableBody) return;

    // Limpiar tabla
    tableBody.innerHTML = '';

    // Ordenar alertas por fecha (más recientes primero)
    const sortedAlerts = [...alerts].sort((a, b) => 
        new Date(b.timestamp) - new Date(a.timestamp)
    );

    // Agregar cada alerta a la tabla
    sortedAlerts.forEach(alert => {
        const row = document.createElement('tr');

        // Formatear fecha
        const date = new Date(alert.timestamp);
        const formattedDate = date.toLocaleString();

        // Obtener ID de DTC del título o URI de definición
        let dtcId = 'N/A';
        if (alert.title && alert.title.includes('DTC')) {
            dtcId = alert.title.split('DTC ')[1];
        } else if (alert.links) {
            const defLink = alert.links.find(link => link.rel === 'alertDefinition');
            if (defLink) {
                dtcId = defLink.uri.split('/').pop();
            }
        }

        row.innerHTML = `
            <td>${formattedDate}</td>
            <td>${alert.type || 'Desconocido'}</td>
            <td><span class="badge bg-severity-${alert.severity}">${alert.severity}</span></td>
            <td>${alert.description || 'Sin descripción'}</td>
            <td>${dtcId}</td>
            <td>${alert.status || 'DESCONOCIDO'}</td>
        `;

        tableBody.appendChild(row);
    });
}

/**
 * Función para actualizar el widget de horómetro
 * @param {Object} engineHoursData - Datos del horómetro de la API
 */
function updateHourmeterWidget(engineHoursData) {
    console.log("Datos del horómetro recibidos:", engineHoursData);

    const hourmeterWidget = document.getElementById('hourmeterWidget');
    const hourmeterValue = document.getElementById('hourmeterValue');
    const hourmeterLastUpdate = document.getElementById('hourmeterLastUpdate');

    if (!hourmeterWidget || !hourmeterValue || !hourmeterLastUpdate) {
        console.warn('No se encontraron elementos del widget de horómetro');
        return;
    }

    if (!engineHoursData || typeof engineHoursData !== 'object') {
        console.warn('Datos de horómetro inválidos o vacíos');
        hourmeterWidget.classList.add('d-none');
        return;
    }

    let latestReading = null;
    let hourValue = null;
    let timestamp = null;

    // Función auxiliar para extraer hora del motor de diferentes estructuras de datos
    const extractHourValue = (data) => {
        if (!data) return null;
        
        // Caso 1: { reading: { valueAsDouble: X } }
        if (data.reading && data.reading.valueAsDouble !== undefined) {
            return data.reading.valueAsDouble;
        }
        
        // Caso 2: { value: X }
        if (data.value !== undefined) {
            return data.value;
        }
        
        // Caso 3: { engineHours: X }
        if (data.engineHours !== undefined) {
            return data.engineHours;
        }
        
        // Caso 4: { hours: X }
        if (data.hours !== undefined) {
            return data.hours;
        }
        
        // Caso 5: objetos anidados
        if (data.engineHoursReading) {
            return extractHourValue(data.engineHoursReading);
        }
        
        return null;
    };

    // Función auxiliar para extraer timestamp
    const extractTimestamp = (data) => {
        if (!data) return null;
        
        // Verificar múltiples propiedades posibles para el timestamp
        return data.timestamp || data.reportTime || data.eventTime || 
               data.lastUpdated || data.reportDateTime || data.dateTime;
    };

    // Caso 1: Array de valores en "values"
    if (engineHoursData.values && Array.isArray(engineHoursData.values) && engineHoursData.values.length > 0) {
        console.log("Procesando estructura con valores en array");
        try {
            // Ordenar por fecha más reciente
            const sortedValues = [...engineHoursData.values].sort((a, b) => {
                const dateA = new Date(extractTimestamp(a) || 0);
                const dateB = new Date(extractTimestamp(b) || 0);
                return dateB - dateA;
            });
            
            latestReading = sortedValues[0];
            hourValue = extractHourValue(latestReading);
            timestamp = extractTimestamp(latestReading);
            
            console.log("Lectura más reciente:", latestReading);
        } catch (error) {
            console.error("Error al procesar array de valores:", error);
        }
    } 
    // Caso 2: Valor directo en el objeto raíz
    else {
        console.log("Procesando estructura con valor directo");
        hourValue = extractHourValue(engineHoursData);
        timestamp = extractTimestamp(engineHoursData);
        latestReading = engineHoursData;
    }

    console.log("Valor de horas extraído:", hourValue);
    console.log("Timestamp extraído:", timestamp);

    // Si no pudimos extraer un valor de horas, ocultar el widget
    if (hourValue === null || hourValue === undefined) {
        console.warn('No se pudo extraer un valor válido del horómetro');
        hourmeterWidget.classList.add('d-none');
        return;
    }

    // Asegurarse de que el valor sea numérico
    try {
        hourValue = parseFloat(hourValue);
        if (isNaN(hourValue)) {
            throw new Error("El valor no es un número");
        }
    } catch (error) {
        console.warn('El valor del horómetro no es un número válido:', hourValue);
        hourmeterWidget.classList.add('d-none');
        return;
    }

    // Formatear y mostrar el valor del horómetro
    const formattedValue = hourValue.toLocaleString('es-CL', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
    });
    hourmeterValue.textContent = `${formattedValue} hrs`;

    // Mostrar la fecha de última actualización
    if (timestamp) {
        try {
            const date = new Date(timestamp);
            if (!isNaN(date.getTime())) {
                hourmeterLastUpdate.textContent = `Última actualización: ${date.toLocaleString('es-CL')}`;
            } else {
                throw new Error("Fecha inválida");
            }
        } catch (error) {
            console.warn("Error al formatear fecha:", timestamp);
            hourmeterLastUpdate.textContent = 'Última actualización: N/A';
        }
    } else {
        hourmeterLastUpdate.textContent = 'Última actualización: N/A';
    }

    // Mostrar el widget y aplicar animación
    hourmeterWidget.classList.remove('d-none');
    hourmeterWidget.style.opacity = '0';
    setTimeout(() => {
        hourmeterWidget.style.transition = 'opacity 0.3s ease';
        hourmeterWidget.style.opacity = '1';
    }, 100);
}

// Función para exportar a Excel
function exportToExcel() {
    const table = document.getElementById('alertsTable');
    if (!table) return;

    // Crear una copia de la tabla para manipular
    const tableClone = table.cloneNode(true);

    // Obtener todas las filas
    const rows = Array.from(tableClone.querySelectorAll('tr'));

    // Convertir a formato CSV
    const csvContent = rows.map(row => {
        return Array.from(row.cells)
            .map(cell => {
                // Obtener solo el texto, ignorando los elementos HTML
                let text = cell.textContent.trim();
                // Escapar comillas dobles y envolver en comillas si contiene comas
                if (text.includes(',') || text.includes('"')) {
                    text = `"${text.replace(/"/g, '""')}"`;
                }
                return text;
            })
            .join(',');
    }).join('\n');

    // Crear el blob y descargar
    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `alertas_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function filterLocationsByDate() {
    if (!selectedOrganizationId) {
        console.log('No hay organización seleccionada');
        return;
    }

    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;

    fetch(`/api/location-history/${selectedOrganizationId}?start_date=${startDate}&end_date=${endDate}`, {
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
    })
    .then(response => response.json())
    .then(data => {
        allLocationData = data;
        renderLocationData(data);
    })
    .catch(error => console.error('Error:', error));
}

// Estos son links a las implementaciones reales en map.js
// La implementación real está en map.js


// Placeholder for MAX_RESULTS constant
const MAX_RESULTS = 100;

function loadLocationHistory(organizationId) {
    selectedOrganizationId = organizationId; // Guardar el ID de la organización seleccionada
    const tbody = document.getElementById('locationHistoryTableBody');
    tbody.innerHTML = '<tr><td colspan="5" class="text-center"><div class="spinner-border" role="status"><span class="visually-hidden">Cargando...</span></div></td></tr>';

    fetch(`/api/location-history/${organizationId}`)
        .then(response => {
            if (!response.ok) {
                throw new Error('Error en la respuesta del servidor');
            }
            return response.json();
        })
        .then(data => {
            allLocationData = data; // Guardar datos completos
            renderLocationData(data); // Renderizar datos iniciales

            // Actualizar el título del dropdown con la organización seleccionada
            const dropdownButton = document.getElementById('organizationDropdown');
            if (dropdownButton) {
                const selectedOrg = document.querySelector(`.organization-item[data-org-id="${organizationId}"]`);
                if (selectedOrg) {
                    dropdownButton.innerHTML = `<i class="fas fa-building me-2"></i> ${selectedOrg.textContent}`;
                }
            }
        })
        .catch(error => {
            console.error('Error:', error);
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">Error al cargar datos: ${error.message}</td></tr>`;
        });
}