// Global variables
let selectedOrganizationId = null;
let selectedMachineId = null;
let machineMarkers = {};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    console.log("Interfaz de dashboard cargada");

    // Initialize the map
    initMap();

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

    // Configurar buscador de organizaciones
    setupOrganizationSearch();

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

    // Manejar el evento de entrada para filtrar la lista
    searchInput.addEventListener('input', function() {
        const searchTerm = this.value.toLowerCase().trim();
        const organizationItems = document.querySelectorAll('.organization-item');
        const noResultsMessage = document.getElementById('noResultsMessage');
        let matchCount = 0;

        // Recorrer cada elemento y mostrar/ocultar según el término de búsqueda
        organizationItems.forEach(item => {
            const orgName = item.textContent.toLowerCase();
            const orgId = item.getAttribute('data-org-id');

            // Verificar si el nombre o ID de la organización contiene el término de búsqueda
            if (orgName.includes(searchTerm) || orgId.includes(searchTerm)) {
                item.parentElement.style.display = ''; // Mostrar este elemento
                matchCount++;
            } else {
                item.parentElement.style.display = 'none'; // Ocultar este elemento
            }
        });

        // Mostrar mensaje de "sin resultados" si no hay coincidencias
        if (noResultsMessage) {
            if (matchCount === 0 && searchTerm.length > 0) {
                noResultsMessage.classList.remove('d-none');
            } else {
                noResultsMessage.classList.add('d-none');
            }
        }
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
                    // Add machines to map with alert colors
                    addMachinesToMap(machines);
                })
                .catch(error => {
                    console.error("Error cargando alertas de las máquinas:", error);
                    // Mostrar las máquinas en el mapa incluso si hay error con las alertas
                    addMachinesToMap(machines);
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

    // Optimización para rendimiento: crear un fragmento de documento
    // para evitar múltiples repaints en grandes cantidades de máquinas
    const fragment = document.createDocumentFragment();

    // Limitar número de máquinas mostradas inicialmente si hay muchas
    // y agregar un botón para cargar más si es necesario
    const CHUNK_SIZE = 100; // Cantidad máxima inicial
    const totalMachines = machines.length;
    let initialMachines = machines;
    let remainingMachines = [];

    if (totalMachines > CHUNK_SIZE) {
        console.log(`Optimizando renderizado para ${totalMachines} máquinas`);
        initialMachines = machines.slice(0, CHUNK_SIZE);
        remainingMachines = machines.slice(CHUNK_SIZE);
    }

    // Función para renderizar un conjunto de máquinas
    const renderMachinesChunk = (machinesList, container) => {
        machinesList.forEach(machine => {
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

            container.appendChild(machineItem);
        });
    };

    // Renderizar el primer conjunto de máquinas
    renderMachinesChunk(initialMachines, fragment);

    // Si hay más máquinas por cargar, agregar botón "Cargar más"
    if (remainingMachines.length > 0) {
        const loadMoreButton = document.createElement('button');
        loadMoreButton.className = 'btn btn-outline-primary btn-sm w-100 mt-2';
        loadMoreButton.textContent = `Cargar más máquinas (${remainingMachines.length} restantes)`;
        loadMoreButton.addEventListener('click', function() {
            this.textContent = 'Cargando...';
            this.disabled = true;

            // Simular una pequeña demora para que la UI pueda actualizarse
            setTimeout(() => {
                // Eliminar el botón "Cargar más"
                this.remove();

                // Renderizar el siguiente conjunto de máquinas
                renderMachinesChunk(remainingMachines, machineListContainer);

                console.log('Máquinas adicionales cargadas');

                // Actualizar búsqueda si hay un término activo
                const searchInput = document.getElementById('machineSearchInput');
                if (searchInput && searchInput.value.trim()) {
                    const event = new Event('input');
                    searchInput.dispatchEvent(event);
                }
            }, 50);
        });

        fragment.appendChild(loadMoreButton);
    }

    // Agregar todos los elementos al contenedor
    machineListContainer.appendChild(fragment);
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
            addMachinesToMap(window.lastLoadedMachines);
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

    // Fetch machine details from API
    fetch(`/api/machine/${machineId}`, {
        credentials: 'same-origin', // Incluir cookies en la petición
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
        })
        .then(machine => {
            console.log("Detalles de máquina recibidos:", machine);

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
            console.error('Error:', error);
            if (emptyAlertMessage) {
                emptyAlertMessage.textContent = 'Error al cargar alertas: ' + error.message;
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

        // Si hay demasiadas coincidencias parciales, limitamos para evitar problemas de rendimiento
        const MAX_RESULTS = 100;
        if (partialMatches.length > MAX_RESULTS) {
            console.log(`Limitando resultados parciales de ${partialMatches.length} a ${MAX_RESULTS}`);
            filteredMachines.push(...partialMatches.slice(0, MAX_RESULTS));
        } else {
            filteredMachines.push(...partialMatches);
        }

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